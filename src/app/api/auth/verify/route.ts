import { z } from "zod";
import { db } from "@/lib/db";
import { publicUser, signToken } from "@/lib/auth";
import { consumeCode } from "@/lib/codes";
import { badRequest, readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ phone: phoneSchema, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });

// Step 2: check the code and sign in. `needs_profile` means ask for name/email.
export const POST = route(async (req) => {
  rateLimit(`auth-verify:${clientIp(req)}`, 30, 60 * 60 * 1000);

  const { phone, code } = await readJson(req, schema);
  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw badRequest("This code has expired. Request a new one.");

  await consumeCode(user.id, "login", code);
  const verified = user.phoneVerifiedAt
    ? user
    : await db.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });

  return Response.json({ token: await signToken(verified), user: publicUser(verified) });
});
