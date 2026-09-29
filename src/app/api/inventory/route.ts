import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { productJson } from "@/lib/serialize";

// Stock management; admins only.
export const GET = route(async (req) => {
  await requireAdmin(req);
  const storeId = new URL(req.url).searchParams.get("store");
  const rows = await db.inventory.findMany({
    where: storeId ? { storeId: Number(storeId) } : undefined,
    include: { product: true },
    orderBy: [{ storeId: "asc" }, { productId: "asc" }],
  });
  return Response.json(rows.map((r) => ({ id: r.id, store_id: r.storeId, quantity: r.quantity, product: productJson(r.product) })));
});

const upsertSchema = z.object({
  store_id: z.number().int().positive(),
  product_id: z.number().int().positive(),
  quantity: z.number().int().min(0),
});

// Sets the stock level for a product at a store (creates the row if needed).
export const POST = route(async (req) => {
  await requireAdmin(req);
  const { store_id, product_id, quantity } = await readJson(req, upsertSchema);
  const row = await db.inventory.upsert({
    where: { storeId_productId: { storeId: store_id, productId: product_id } },
    create: { storeId: store_id, productId: product_id, quantity },
    update: { quantity },
  });
  return Response.json({ id: row.id, store_id: row.storeId, product_id: row.productId, quantity: row.quantity }, { status: 201 });
});
