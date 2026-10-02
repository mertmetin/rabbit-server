import { z } from "zod";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, idParam, notFound, readJson, route } from "@/lib/http";
import { orderJson } from "@/lib/orders";
import { stripe, stripeCustomerId } from "@/lib/stripe";

const schema = z.object({
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
  // Extra tip for the driver, charged now to the card the order was paid with.
  extra_tip_cents: z.number().int().min(0).max(10_000).default(0),
});

// After delivery: rate the order once, optionally adding to the tip.
export const POST = route(async (req, ctx: RouteContext<"/api/orders/[id]/rating">) => {
  const user = await requireUser(req);
  const id = await idParam(ctx);
  const order = await db.order.findFirst({ where: { id, userId: user.id } });
  if (!order) throw notFound("Order not found.");
  if (order.status !== "delivered") throw new ApiError(409, "You can rate an order once it's delivered.");
  if (order.ratedAt) throw new ApiError(409, "You've already rated this order.");

  const body = await readJson(req, schema);

  let extraTipPaymentIntentId: string | null = null;
  if (body.extra_tip_cents > 0) {
    if (!order.stripePaymentIntentId) throw new ApiError(409, "This order has no card to tip with.");
    const paid = await stripe().paymentIntents.retrieve(order.stripePaymentIntentId);
    const paymentMethod = typeof paid.payment_method === "string" ? paid.payment_method : paid.payment_method?.id;
    if (!paymentMethod) throw new ApiError(409, "This order has no card to tip with.");
    try {
      const tip = await stripe().paymentIntents.create({
        amount: body.extra_tip_cents,
        currency: "cad",
        customer: await stripeCustomerId(user),
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: `Rabbit order #${order.id}: extra tip`,
        metadata: { order_id: String(order.id), user_id: String(user.id), kind: "extra_tip" },
      });
      if (tip.status !== "succeeded") throw new ApiError(402, "Your bank didn't accept the tip. Try a different amount later.");
      extraTipPaymentIntentId = tip.id;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof Stripe.errors.StripeCardError) throw new ApiError(402, err.message);
      throw err;
    }
  }

  const rated = await db.order.update({
    where: { id: order.id },
    data: {
      rating: body.stars,
      ratingComment: body.comment || null,
      ratedAt: new Date(),
      extraTipCents: body.extra_tip_cents,
      extraTipPaymentIntentId,
    },
    include: { items: true },
  });
  return Response.json(orderJson(rated));
});
