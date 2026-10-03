import { z } from "zod";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, readJson, route } from "@/lib/http";
import { MIN_ORDER_CENTS } from "@/lib/delivery";
import { isStoreOpen } from "@/lib/stores";
import { basketSchema, deliveryContext, orderJson, priceBasket, releaseAbandonedOrders, restock } from "@/lib/orders";
import { stripe, stripeCustomerId } from "@/lib/stripe";
import { addressJson } from "@/lib/serialize";

// The signed-in customer's orders, newest first.
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const orders = await db.order.findMany({
    where: { userId: user.id, status: { not: "pending_payment" } },
    include: { items: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return Response.json(orders.map(orderJson));
});

const placeSchema = basketSchema.extend({
  payment_method_id: z.string().startsWith("pm_", "Choose a card."),
  notes: z.string().trim().max(500).optional(),
  contactless: z.boolean().default(false),
  no_bell: z.boolean().default(false),
  substitutions: z.enum(["similar", "skip"]).default("similar"),
  // Driver tip in cents, added to the card hold.
  tip_cents: z.number().int().min(0).max(10_000).default(0),
});

// Places an order: prices it, reserves stock, and charges the chosen card.
// The order becomes "placed" once the app confirms the payment went through.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req, placeSchema);
  // Free up stock held by checkouts that were abandoned before paying.
  await releaseAbandonedOrders(new Date(), body.store_id);

  const order = await db.$transaction(async (tx) => {
    const { address, store } = await deliveryContext(tx, user.id, body.store_id, body.address_id);
    if (!(await isStoreOpen(store.id))) {
      throw new ApiError(409, `${store.name} isn't taking orders right now. Please try again a bit later.`);
    }
    const priced = await priceBasket(tx, user.id, body.store_id, body.items, address.provinceCode);
    if (priced.subtotal < MIN_ORDER_CENTS) {
      throw new ApiError(400, `The minimum order is $${(MIN_ORDER_CENTS / 100).toFixed(2)}.`);
    }

    // Reserve stock; the condition stops two orders taking the last unit.
    for (const line of priced.lines) {
      const { count } = await tx.inventory.updateMany({
        where: { storeId: body.store_id, productId: line.productId, quantity: { gte: line.quantity } },
        data: { quantity: { decrement: line.quantity } },
      });
      if (count === 0) throw new ApiError(409, `Sorry, ${line.title} just sold out.`);
    }

    return tx.order.create({
      data: {
        userId: user.id,
        storeId: body.store_id,
        addressId: address.id,
        deliveryAddress: addressJson(address),
        subtotalCents: priced.subtotal,
        taxCents: priced.tax,
        deliveryFeeCents: priced.delivery.cents,
        tipCents: body.tip_cents,
        totalCents: priced.total + body.tip_cents,
        notes: body.notes || null,
        contactless: body.contactless,
        noBell: body.no_bell,
        substitutions: body.substitutions,
        items: { create: priced.lines },
      },
      include: { items: true },
    });
  });

  try {
    const customer = await stripeCustomerId(user);
    const method = await stripe().paymentMethods.retrieve(body.payment_method_id);
    if (method.customer !== customer) throw new ApiError(404, "Card not found.");

    // Authorize the chosen saved card for the checkout total now; what was
    // actually found is charged after shopping (lib/shopping.ts). If the bank
    // wants 3-D Secure, the intent comes back as requires_action and the app
    // shows Stripe's prompt.
    const intent = await stripe().paymentIntents.create({
      amount: order.totalCents,
      currency: "cad",
      customer,
      payment_method: method.id,
      capture_method: "manual",
      confirm: true,
      payment_method_types: ["card"],
      description: `Rabbit order #${order.id}`,
      metadata: { order_id: String(order.id), user_id: String(user.id) },
    });
    await db.order.update({ where: { id: order.id }, data: { stripePaymentIntentId: intent.id } });

    return Response.json(
      { order: orderJson(order), payment: { status: intent.status, client_secret: intent.client_secret } },
      { status: 201 },
    );
  } catch (err) {
    // Payment failed or couldn't start: release the stock and drop the order.
    await db.$transaction(async (tx) => {
      await restock(tx, order);
      await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
    });
    if (err instanceof ApiError) throw err;
    if (err instanceof Stripe.errors.StripeCardError) throw new ApiError(402, err.message);
    console.error(err);
    throw new ApiError(502, "We couldn't take the payment. Please try again.");
  }
});
