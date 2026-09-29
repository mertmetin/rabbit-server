import { z } from "zod";
import { db } from "@/lib/db";
import { issueCode } from "@/lib/codes";
import { notFound, readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";

// Texts a password reset code. The code itself is never returned.
export const POST = route(async (req) => {
  const { phone } = await readJson(req, z.object({ phone: phoneSchema }));
  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw notFound("No account uses that phone number.");

  await issueCode(user, "password_reset");
  return Response.json({ user_id: user.id, phone: user.phone }, { status: 201 });
});
