import { db } from "@/lib/db";
import { assertSelf, requireUser } from "@/lib/auth";
import { idParam, route } from "@/lib/http";

// Un-hearts a product. Removing one that isn't a favourite is fine.
export const DELETE = route(async (req, ctx: RouteContext<"/api/users/[id]/favorites/[productId]">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);

  await db.favorite.deleteMany({ where: { userId, productId: await idParam(ctx, "productId") } });
  return new Response(null, { status: 204 });
});
