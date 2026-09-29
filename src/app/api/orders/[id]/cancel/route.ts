import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, idParam, notFound, route } from "@/lib/http";
import { orderJson, restock } from "@/lib/orders";
import { stripe } from "@/lib/stripe";

// Customers can cancel until the store starts preparing the order.
// Stock goes back on the shelf and any payment is refunded in full.
export const POST = route(async (req, ctx: RouteContext<"/api/orders/[id]/cancel">) => {
  const user = await requireUser(req);
  const id = await idParam(ctx);
  const order = await db.order.findFirst({ where: { id, userId: user.id }, include: { items: true } });
  if (!order) throw notFound("Order not found.");
  if (order.status === "cancelled") return Response.json(orderJson(order));
  if (order.status !== "pending_payment" && order.status !== "placed") {
    throw new ApiError(409, "This order is already being prepared and can't be cancelled.");
  }

  if (order.stripePaymentIntentId) {
    const intent = await stripe().paymentIntents.retrieve(order.stripePaymentIntentId);
    if (intent.status === "succeeded") {
      await stripe().refunds.create({ payment_intent: intent.id });
    } else if (intent.status !== "canceled") {
      await stripe().paymentIntents.cancel(intent.id);
    }
  }

  const cancelled = await db.$transaction(async (tx) => {
    await restock(tx, order);
    return tx.order.update({ where: { id: order.id }, data: { status: "cancelled" }, include: { items: true } });
  });
  return Response.json(orderJson(cancelled));
});
