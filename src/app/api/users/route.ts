import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { issueCode } from "@/lib/codes";
import { readJson, route } from "@/lib/http";
import { phoneSchema } from "@/lib/phone";

const registerSchema = z.object({
  name: z.string().trim().min(1).max(255),
  phone: phoneSchema,
  email: z.email().max(255).transform((e) => e.toLowerCase()),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
});

// Sign up. The account stays inactive until the SMS code is confirmed.
export const POST = route(async (req) => {
  const data = await readJson(req, registerSchema);
  const user = await db.user.create({
    data: { name: data.name, phone: data.phone, email: data.email, passwordHash: await hashPassword(data.password) },
  });
  await issueCode(user, "activation");
  return Response.json({ id: user.id, phone: user.phone }, { status: 201 });
});
