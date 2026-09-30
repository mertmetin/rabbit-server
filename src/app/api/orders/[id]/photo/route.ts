import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { idParam, notFound, route } from "@/lib/http";
import { photoResponse } from "@/lib/photo";

// The doorstep photo: visible to the order's customer, its driver and admins.
export const GET = route(async (req, ctx: RouteContext<"/api/orders/[id]/photo">) => {
  const user = await requireUser(req);
  const order = await db.order.findUnique({ where: { id: await idParam(ctx) } });
  if (!order || (user.role !== "admin" && order.userId !== user.id && order.driverId !== user.id)) {
    throw notFound("Order not found.");
  }
  return photoResponse(order);
});
