import { z } from "zod";
import { db } from "@/lib/db";
import { assertSelf, checkPassword, hashPassword, requireUser } from "@/lib/auth";
import { badRequest, idParam, readJson, route } from "@/lib/http";

const schema = z.object({
  current_password: z.string().min(1),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

// Change password from the profile (knowing the current one).
export const PUT = route(async (req, ctx: RouteContext<"/api/users/[id]/password">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);
  const { current_password, password } = await readJson(req, schema);
  if (!(await checkPassword(current_password, user.passwordHash))) throw badRequest("Your current password is wrong.");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  return Response.json(true);
});
