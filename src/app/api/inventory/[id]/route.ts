import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { idParam, notFound, readJson, route } from "@/lib/http";

export const PUT = route(async (req, ctx: RouteContext<"/api/inventory/[id]">) => {
  await requireAdmin(req);
  const id = await idParam(ctx);
  const { quantity } = await readJson(req, z.object({ quantity: z.number().int().min(0) }));
  const row = await db.inventory.findUnique({ where: { id } });
  if (!row) throw notFound();
  const updated = await db.inventory.update({ where: { id }, data: { quantity } });
  return Response.json({ id: updated.id, store_id: updated.storeId, product_id: updated.productId, quantity: updated.quantity });
});

export const DELETE = route(async (req, ctx: RouteContext<"/api/inventory/[id]">) => {
  await requireAdmin(req);
  const id = await idParam(ctx);
  const { count } = await db.inventory.deleteMany({ where: { id } });
  if (count === 0) throw notFound();
  return new Response(null, { status: 204 });
});
