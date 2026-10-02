import { z } from "zod";
import { db } from "@/lib/db";
import { publicUser, readLinkToken, signToken } from "@/lib/auth";
import { consumeCode } from "@/lib/codes";
import { badRequest, readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const schema = z.object({
  phone: phoneSchema,
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code."),
  link_token: z.string().optional(), // from /api/auth/google: link that Google account
});

// Step 2: check the code and sign in. `needs_profile` means ask for name/email.
// With a Google link token, the Google account is linked and fills in a
// missing name and email.
export const POST = route(async (req) => {
  rateLimit(`auth-verify:${clientIp(req)}`, 30, 60 * 60 * 1000);

  const { phone, code, link_token } = await readJson(req, schema);
  const google = link_token ? await readLinkToken(link_token) : null;
  if (link_token && !google) throw badRequest("Google sign-in took too long. Please try again.");
  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw badRequest("This code has expired. Request a new one.");

  await consumeCode(user.id, "login", code);

  const data: { phoneVerifiedAt?: Date; googleSub?: string; name?: string; email?: string } = {};
  if (!user.phoneVerifiedAt) data.phoneVerifiedAt = new Date();
  if (google) {
    const linked = await db.user.findUnique({ where: { googleSub: google.sub } });
    if (linked && linked.id !== user.id) throw badRequest("This Google account is already linked to another phone number.");
    data.googleSub = google.sub;
    if (!user.name && google.name) data.name = google.name;
    if (!user.email && google.email && !(await db.user.findUnique({ where: { email: google.email } }))) data.email = google.email;
  }
  const verified = Object.keys(data).length ? await db.user.update({ where: { id: user.id }, data }) : user;

  return Response.json({ token: await signToken(verified), user: publicUser(verified) });
});
