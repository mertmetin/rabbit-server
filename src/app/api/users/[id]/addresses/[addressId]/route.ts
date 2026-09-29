import { db } from "@/lib/db";
import { assertSelf, requireUser } from "@/lib/auth";
import { idParam, notFound, readJson, route } from "@/lib/http";
import { addressJson } from "@/lib/serialize";
import { addressBodySchema } from "@/lib/addresses";

type Ctx = RouteContext<"/api/users/[id]/addresses/[addressId]">;

async function findOwned(req: Request, ctx: Ctx) {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);
  const addressId = await idParam(ctx, "addressId");
  const address = await db.userAddress.findFirst({ where: { id: addressId, userId } });
  if (!address) throw notFound("This address no longer exists.");
  return address;
}

export const PUT = route(async (req, ctx: Ctx) => {
  const address = await findOwned(req, ctx);
  const body = await readJson(req, addressBodySchema);
  const updated = await db.userAddress.update({ where: { id: address.id }, data: body.address });
  return Response.json(addressJson(updated));
});

export const DELETE = route(async (req, ctx: Ctx) => {
  const address = await findOwned(req, ctx);
  await db.userAddress.delete({ where: { id: address.id } });
  return new Response(null, { status: 204 });
});
