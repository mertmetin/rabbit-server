import { z } from "zod";
import { db } from "@/lib/db";
import { issueCode } from "@/lib/codes";
import { readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { smsIsFake } from "@/lib/sms";

// Step 1 of signing in (or up): text a 6-digit code to this number.
// New numbers get an account right away; it's only usable once verified.
export const POST = route(async (req) => {
  // Per-device cap on top of the per-number limits in issueCode, so nobody can
  // script texts to thousands of numbers (SMS fraud runs up the bill).
  rateLimit(`auth-start:${clientIp(req)}`, 10, 60 * 60 * 1000);

  const { phone } = await readJson(req, z.object({ phone: phoneSchema }));
  const user = await db.user.upsert({ where: { phone }, update: {}, create: { phone } });
  const code = await issueCode(user, "login");

  return Response.json({
    phone,
    is_new: !user.phoneVerifiedAt || !user.name,
    // Only while texts are printed instead of sent, on a development machine.
    ...(smsIsFake() ? { dev_code: code } : {}),
  });
});
