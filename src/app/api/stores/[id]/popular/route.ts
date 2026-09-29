import { db } from "@/lib/db";
import { idParam, route } from "@/lib/http";
import { activeStore } from "@/lib/catalog";
import { productJson } from "@/lib/serialize";

const LIMIT = 12;

// Best sellers at this store (by units ordered), topped up with other in-stock
// products so a new store still has something to show.
export const GET = route(async (_req, ctx: RouteContext<"/api/stores/[id]/popular">) => {
  const store = await activeStore(await idParam(ctx));

  const sold = await db.orderItem.groupBy({
    by: ["productId"],
    where: { order: { storeId: store.id, status: { not: "cancelled" } } },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: 50,
  });
  const rank = new Map(sold.map((row, i) => [row.productId, i]));

  const stock = await db.inventory.findMany({
    where: { storeId: store.id, quantity: { gt: 0 } },
    include: { product: true },
  });

  const popular = stock
    .sort((a, b) => (rank.get(a.productId) ?? Infinity) - (rank.get(b.productId) ?? Infinity) || a.productId - b.productId)
    .slice(0, LIMIT)
    .map(({ product, quantity }) => productJson(product, quantity));

  return Response.json(popular);
});
