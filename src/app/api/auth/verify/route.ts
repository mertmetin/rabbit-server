import { z } from "zod";
import { db } from "@/lib/db";
import { signSetupToken } from "@/lib/auth";
import { consumeCode } from "@/lib/codes";
import { badRequest, readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ phone: phoneSchema, code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code.") });

// Checks the SMS code. Returns a 15-minute setup token for the next step
// (create the account, or choose a new password) — not a sign-in session.
export const POST = route(async (req) => {
  rateLimit(`auth-verify:${clientIp(req)}`, 30, 60 * 60 * 1000);

  const { phone, code } = await readJson(req, schema);
  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw badRequest("This code has expired. Request a new one.");

  await consumeCode(user.id, "login", code);
  return Response.json({ setup_token: await signSetupToken(user), is_new: !user.passwordHash });
});
