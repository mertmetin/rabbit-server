import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, publicUser, signToken } from "@/lib/auth";
import { readJson, route, unauthorized } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// Returning customers: phone + password.
export const POST = route(async (req) => {
  const { phone, password } = await readJson(req, z.object({ phone: phoneSchema, password: z.string().min(1) }));
  // Slow down password guessing, per device and per account.
  rateLimit(`auth-login-ip:${clientIp(req)}`, 30, 15 * 60 * 1000);
  rateLimit(`auth-login-phone:${phone}`, 10, 15 * 60 * 1000);

  const user = await db.user.findUnique({ where: { phone } });
  if (!user || !user.phoneVerifiedAt || !(await checkPassword(password, user.passwordHash))) {
    throw unauthorized("Wrong password. Try again or reset it.");
  }
  return Response.json({ token: await signToken(user), user: publicUser(user) });
});
