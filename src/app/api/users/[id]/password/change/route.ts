import { z } from "zod";
import { db } from "@/lib/db";
import { assertSelf, checkPassword, hashPassword, requireUser } from "@/lib/auth";
import { badRequest, idParam, readJson, route } from "@/lib/http";

const schema = z.object({
  oldPassword: z.string().min(1),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

export const PATCH = route(async (req, ctx: RouteContext<"/api/users/[id]/password/change">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);
  const { oldPassword, password } = await readJson(req, schema);

  // Always check the signed-in user's own current password.
  if (!(await checkPassword(oldPassword, user.passwordHash))) throw badRequest("Wrong password.");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  return Response.json(true);
});
