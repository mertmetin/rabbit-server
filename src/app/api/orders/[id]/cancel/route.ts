import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { ApiError, idParam, notFound, route } from "@/lib/http";
import { cancelOrder, orderJson } from "@/lib/orders";

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

  const cancelled = await cancelOrder(order);
  return Response.json(orderJson(cancelled));
});
