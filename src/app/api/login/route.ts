import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, signToken } from "@/lib/auth";
import { readJson, route, unauthorized } from "@/lib/http";
import { normalizePhone } from "@/lib/phone";

const schema = z.object({ phone: z.string(), password: z.string() });

export const POST = route(async (req) => {
  const { phone, password } = await readJson(req, schema);
  const normalized = normalizePhone(phone);
  const user = normalized ? await db.user.findUnique({ where: { phone: normalized } }) : null;

  // Same message for unknown phone and wrong password.
  if (!user || !(await checkPassword(password, user.passwordHash))) {
    throw unauthorized("Wrong phone number or password.");
  }
  if (!user.phoneVerifiedAt) {
    return Response.json(
      { message: "Please activate your account with the code we texted you.", user_id: user.id, phone: user.phone },
      { status: 403 },
    );
  }
  return Response.json({ token: await signToken(user) });
});
