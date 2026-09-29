import { z } from "zod";
import { idParam, route } from "@/lib/http";
import { activeStore, inStock } from "@/lib/catalog";
import { productJson } from "@/lib/serialize";

// Products in a top-level category, grouped into sections by subcategory
// (the shape of the app's SectionList: [{ title, data: [...] }]).
export const GET = route(async (req, ctx: RouteContext<"/api/stores/[id]/products">) => {
  const store = await activeStore(await idParam(ctx));
  const { category } = z
    .object({ category: z.coerce.number().int().positive() })
    .parse(Object.fromEntries(new URL(req.url).searchParams));

  const stock = (await inStock(store.id)).filter(
    ({ product }) => product.categoryId === category || product.category.parentId === category,
  );

  const sections = new Map<number, { id: number; title: string; sortOrder: number; data: ReturnType<typeof productJson>[] }>();
  for (const { product, quantity } of stock) {
    const c = product.category;
    const section = sections.get(c.id) ?? { id: c.id, title: c.title, sortOrder: c.id === category ? -1 : c.sortOrder, data: [] };
    section.data.push(productJson(product, quantity));
    sections.set(c.id, section);
  }

  const result = [...sections.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
    .map(({ id, title, data }) => ({ id, title, data: data.sort((a, b) => a.title.localeCompare(b.title)) }));

  return Response.json(result);
});
