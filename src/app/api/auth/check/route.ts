import { z } from "zod";
import { db } from "@/lib/db";
import { readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Step 1: is there an account for this number? Existing customers go on to
// their password; new numbers get an SMS code to verify the phone.
export const POST = route(async (req) => {
  rateLimit(`auth-check:${clientIp(req)}`, 30, 60 * 60 * 1000);
  const { phone } = await readJson(req, z.object({ phone: phoneSchema }));
  const user = await db.user.findUnique({ where: { phone } });
  return Response.json({ phone, exists: Boolean(user?.phoneVerifiedAt && user.passwordHash) });
});
