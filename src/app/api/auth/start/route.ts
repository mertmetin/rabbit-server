import { z } from "zod";
import { db } from "@/lib/db";
import { issueCode } from "@/lib/codes";
import { ApiError, notFound, readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({ phone: phoneSchema, purpose: z.enum(["signup", "reset"]) });

// Texts a 6-digit code: to verify a new customer's phone, or to reset a password.
export const POST = route(async (req) => {
  // Per-device cap on top of the per-number limits in issueCode, so nobody can
  // script texts to thousands of numbers (SMS fraud runs up the bill).
  rateLimit(`auth-start:${clientIp(req)}`, 10, 60 * 60 * 1000);

  const { phone, purpose } = await readJson(req, schema);
  const existing = await db.user.findUnique({ where: { phone } });
  const registered = Boolean(existing?.phoneVerifiedAt && existing.passwordHash);

  if (purpose === "signup" && registered) throw new ApiError(409, "This number already has an account. Sign in instead.");
  if (purpose === "reset" && !registered) throw notFound("No account uses this number.");

  const user = existing ?? (await db.user.create({ data: { phone } }));
  await issueCode(user, "login");
  return Response.json({ phone });
});
