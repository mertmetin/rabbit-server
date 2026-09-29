import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { idParam, notFound, route } from "@/lib/http";
import { orderJson } from "@/lib/orders";

export const GET = route(async (req, ctx: RouteContext<"/api/orders/[id]">) => {
  const user = await requireUser(req);
  const id = await idParam(ctx);
  const order = await db.order.findFirst({
    where: { id, ...(user.role === "admin" ? {} : { userId: user.id }) },
    include: { items: true },
  });
  if (!order) throw notFound("Order not found.");
  return Response.json(orderJson(order));
});
