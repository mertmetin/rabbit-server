import { z } from "zod";
import { db } from "@/lib/db";
import { issueCode } from "@/lib/codes";
import { badRequest, idParam, notFound, readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";

// Resend the activation code; the phone must match the account.
export const POST = route(async (req, ctx: RouteContext<"/api/users/[id]/token/resend">) => {
  const userId = await idParam(ctx);
  const { phone } = await readJson(req, z.object({ phone: phoneSchema }));
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.phone !== phone) throw notFound();
  if (user.phoneVerifiedAt) throw badRequest("This account is already activated.");

  await issueCode(user, "activation");
  return Response.json(true);
});
