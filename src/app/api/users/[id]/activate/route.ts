import { z } from "zod";
import { db } from "@/lib/db";
import { consumeCode } from "@/lib/codes";
import { badRequest, idParam, notFound, readJson, route } from "@/lib/http";

export const PATCH = route(async (req, ctx: RouteContext<"/api/users/[id]/activate">) => {
  const userId = await idParam(ctx);
  const { token } = await readJson(req, z.object({ token: z.string().min(1) }));
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();
  if (user.phoneVerifiedAt) throw badRequest("This account is already activated.");

  await consumeCode(user.id, "activation", token);
  await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
  return Response.json(true);
});
