import { db } from "@/lib/db";
import { assertSelf, requireUser } from "@/lib/auth";
import { idParam, readJson, route } from "@/lib/http";
import { addressBodySchema } from "@/lib/addresses";
import { addressJson } from "@/lib/serialize";

export const GET = route(async (req, ctx: RouteContext<"/api/users/[id]/addresses">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);

  const addresses = await db.userAddress.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  return Response.json(addresses.map(addressJson));
});

export const POST = route(async (req, ctx: RouteContext<"/api/users/[id]/addresses">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);

  const body = await readJson(req, addressBodySchema);
  const created = await db.userAddress.create({ data: { ...body.address, userId } });
  return Response.json(addressJson(created), { status: 201 });
});
