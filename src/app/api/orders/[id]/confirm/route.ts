import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, idParam, notFound, route } from "@/lib/http";
import { orderJson } from "@/lib/orders";
import { stripe } from "@/lib/stripe";

// Called by the app after the payment sheet closes. Stripe is the source of
// truth: the order is only placed if its payment actually succeeded.
export const POST = route(async (req, ctx: RouteContext<"/api/orders/[id]/confirm">) => {
  const user = await requireUser(req);
  const id = await idParam(ctx);
  const order = await db.order.findFirst({ where: { id, userId: user.id }, include: { items: true } });
  if (!order) throw notFound("Order not found.");
  if (order.status !== "pending_payment") return Response.json(orderJson(order));
  if (!order.stripePaymentIntentId) throw new ApiError(409, "This order has no payment.");

  const intent = await stripe().paymentIntents.retrieve(order.stripePaymentIntentId);
  if (intent.status !== "succeeded" && intent.status !== "processing") {
    throw new ApiError(402, "The payment hasn't gone through yet.");
  }

  const placed = await db.order.update({
    where: { id: order.id },
    data: { status: "placed", placedAt: new Date() },
    include: { items: true },
  });
  return Response.json(orderJson(placed));
});
