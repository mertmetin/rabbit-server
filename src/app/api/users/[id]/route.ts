import { z } from "zod";
import { db } from "@/lib/db";
import { assertSelf, publicUser, requireUser, signToken } from "@/lib/auth";
import { idParam, readJson, route } from "@/lib/http";
import { deleteAccount } from "@/lib/account";

const editSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  email: z.email().max(255).transform((e) => e.toLowerCase()).optional(),
});

// Phone changes would need a new SMS check, so they aren't allowed here.
// Returns a fresh token too, since the app shows the name from the token.
export const PUT = route(async (req, ctx: RouteContext<"/api/users/[id]">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);
  const data = await readJson(req, editSchema);

  const updated = await db.user.update({ where: { id: userId }, data });
  return Response.json({ ...publicUser(updated), token: user.id === updated.id ? await signToken(updated) : undefined });
});

export const DELETE = route(async (req, ctx: RouteContext<"/api/users/[id]">) => {
  const user = await requireUser(req);
  const userId = await idParam(ctx);
  assertSelf(user, userId);

  await deleteAccount(userId);
  return new Response(null, { status: 204 });
});
