import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { consumeCode } from "@/lib/codes";
import { idParam, notFound, readJson, route } from "@/lib/http";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

export const PATCH = route(async (req, ctx: RouteContext<"/api/users/[id]/password/reset">) => {
  const userId = await idParam(ctx);
  const { token, password } = await readJson(req, schema);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound();

  await consumeCode(user.id, "password_reset", token);
  // Receiving the code by SMS also proves the phone, so activate if needed.
  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(password), phoneVerifiedAt: user.phoneVerifiedAt ?? new Date() },
  });
  return Response.json(true);
});
