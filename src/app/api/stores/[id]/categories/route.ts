import { db } from "@/lib/db";
import { idParam, route } from "@/lib/http";
import { activeStore, inStock } from "@/lib/catalog";
import { absoluteUrl } from "@/lib/serialize";

// Top-level categories that have something in stock at this store.
export const GET = route(async (req, ctx: RouteContext<"/api/stores/[id]/categories">) => {
  const store = await activeStore(await idParam(ctx));
  const stock = await inStock(store.id);

  const topIds = new Set(stock.map(({ product }) => product.category.parentId ?? product.category.id));
  const categories = await db.productCategory.findMany({
    where: { id: { in: [...topIds] } },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
  return Response.json(
    categories.map((c) => ({ id: c.id, title: c.title, description: c.description, image: absoluteUrl(c.image, req) })),
  );
});
