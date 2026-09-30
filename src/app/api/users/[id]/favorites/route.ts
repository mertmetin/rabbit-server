import { z } from "zod";
import { db } from "@/lib/db";
import { assertSelf, requireUser } from "@/lib/auth";
import { idParam, notFound, readJson, route } from "@/lib/http";
import { productJson } from "@/lib/serialize";

const querySchema = z.object({ store_id: z.coerce.number().int().positive().optional() });

// The customer's favourites, newest first. With store_id, each carries that
// store's stock (0 when it isn't on the shelf there) so the app can show
// which ones can be added to the basket right now.
export const GET = route(async (req, ctx: RouteContext<"/api/users/[id]/favorites">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);
  const { store_id } = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));

  const favorites = await db.favorite.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { product: { include: { inventory: { where: { storeId: store_id ?? -1 } } } } },
  });
  return Response.json(
    favorites.map(({ product }) =>
      productJson(product, store_id === undefined ? undefined : (product.inventory[0]?.quantity ?? 0)),
    ),
  );
});

const bodySchema = z.object({ product_id: z.number().int().positive() });

// Hearts a product. Saving one that's already a favourite is fine.
export const POST = route(async (req, ctx: RouteContext<"/api/users/[id]/favorites">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);

  const { product_id } = await readJson(req, bodySchema);
  if (!(await db.product.findUnique({ where: { id: product_id } }))) throw notFound("This product isn't available.");
  await db.favorite.upsert({
    where: { userId_productId: { userId, productId: product_id } },
    create: { userId, productId: product_id },
    update: {},
  });
  return new Response(null, { status: 204 });
});
