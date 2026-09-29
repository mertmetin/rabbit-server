import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, readJson, route } from "@/lib/http";
import { basketSchema, deliveryContext, MIN_ORDER_CENTS, orderJson, priceBasket, restock } from "@/lib/orders";
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
  notes: z.string().trim().max(500).optional(),
  contactless: z.boolean().default(false),
  no_bell: z.boolean().default(false),
});

// Places an order: prices it, reserves stock, and starts a Stripe payment.
// The order becomes "placed" once the app confirms the payment went through.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req, placeSchema);

  const order = await db.$transaction(async (tx) => {
    const { address } = await deliveryContext(tx, user.id, body.store_id, body.address_id);
    const priced = await priceBasket(tx, body.store_id, body.items, address.provinceCode);
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
        totalCents: priced.total,
        notes: body.notes || null,
        contactless: body.contactless,
        noBell: body.no_bell,
        items: { create: priced.lines },
      },
      include: { items: true },
    });
  });

  try {
    const customer = await stripeCustomerId(user);
    const intent = await stripe().paymentIntents.create({
      amount: order.totalCents,
      currency: "cad",
      customer,
      setup_future_usage: "off_session", // save the card for next time
      automatic_payment_methods: { enabled: true },
      description: `Rabbit order #${order.id}`,
      metadata: { order_id: String(order.id), user_id: String(user.id) },
    });
    const ephemeralKey = await stripe().ephemeralKeys.create({ customer }, { apiVersion: "2020-08-27" });
    await db.order.update({ where: { id: order.id }, data: { stripePaymentIntentId: intent.id } });

    return Response.json(
      {
        order: orderJson(order),
        payment: {
          client_secret: intent.client_secret,
          customer_id: customer,
          ephemeral_key: ephemeralKey.secret,
          publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // Payment couldn't start: release the stock and drop the order.
    await db.$transaction(async (tx) => {
      await restock(tx, order);
      await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
    });
    console.error(err);
    throw new ApiError(502, "We couldn't start the payment. Please try again.");
  }
});
