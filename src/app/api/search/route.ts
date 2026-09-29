import { z } from "zod";
import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { activeStore } from "@/lib/catalog";
import { productJson } from "@/lib/serialize";

const querySchema = z.object({
  store_id: z.coerce.number().int().positive(),
  q: z.string().trim().min(2, "Type at least 2 letters."),
});

// Products in stock at the store whose title or description matches.
// Returns `{ hits }` like the Algolia response the app was written for.
export const GET = route(async (req) => {
  const { store_id, q } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  await activeStore(store_id);

  const stock = await db.inventory.findMany({
    where: {
      storeId: store_id,
      quantity: { gt: 0 },
      product: { OR: [{ title: { contains: q } }, { description: { contains: q } }] },
    },
    include: { product: true },
    take: 50,
  });

  const hits = stock
    .map(({ product, quantity }) => productJson(product, quantity))
    .sort((a, b) => Number(b.title.toLowerCase().includes(q.toLowerCase())) - Number(a.title.toLowerCase().includes(q.toLowerCase())));
  return Response.json({ hits, query: q });
});
