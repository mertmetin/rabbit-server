import { z } from "zod";
import { db } from "@/lib/db";
import { publicUser, signLinkToken, signToken } from "@/lib/auth";
import { verifyGoogleIdToken } from "@/lib/google";
import { readJson, route } from "@/lib/http";
import { clientIp, rateLimit } from "@/lib/rate-limit";

// "Continue with Google". A Google account already linked to a customer signs
// straight in. Otherwise the customer confirms their phone number once (Rabbit
// accounts are phone-based): `link_token` goes along with the SMS code to
// /api/auth/verify, which links the Google account.
export const POST = route(async (req) => {
  rateLimit(`auth-google:${clientIp(req)}`, 30, 60 * 60 * 1000);

  const { id_token } = await readJson(req, z.object({ id_token: z.string().min(1) }));
  const google = await verifyGoogleIdToken(id_token);

  const user = await db.user.findUnique({ where: { googleSub: google.sub } });
  if (user?.phoneVerifiedAt) return Response.json({ token: await signToken(user), user: publicUser(user) });

  return Response.json({
    needs_phone: true,
    link_token: await signLinkToken(google),
    name: google.name,
    email: google.email,
  });
});
