import { db } from "@/lib/db";
import { idParam, notFound, route } from "@/lib/http";
import { activeStore } from "@/lib/catalog";
import { productJson } from "@/lib/serialize";

// The in-stock variants of a product's group at this store, with the group's
// options (names and values in display order) for the app's option chips.
// A product outside a group is its own only variant.
export const GET = route(async (_req, ctx: RouteContext<"/api/stores/[id]/products/[productId]/variants">) => {
  const store = await activeStore(await idParam(ctx));
  const product = await db.product.findUnique({ where: { id: await idParam(ctx, "productId") }, include: { group: true } });
  if (!product) throw notFound("This product isn't available.");

  const stock = await db.inventory.findMany({
    where: { storeId: store.id, quantity: { gt: 0 }, product: product.groupId ? { groupId: product.groupId } : { id: product.id } },
    include: { product: true },
    orderBy: { productId: "asc" },
  });

  return Response.json({
    options: product.group?.options ?? [],
    variants: stock.map(({ product, quantity }) => productJson(product, quantity)),
  });
});
