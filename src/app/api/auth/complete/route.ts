import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, publicUser, signToken, userFromSetupToken } from "@/lib/auth";
import { readJson, route, unauthorized } from "@/lib/http";

const schema = z.object({
  setup_token: z.string().min(1),
  password: z.string().min(8, "Use at least 8 characters.").max(200),
  name: z.string().trim().min(1).max(255).optional(),
  email: z.email().max(255).transform((e) => e.toLowerCase()).optional(),
});

// Final step after the SMS code: set the password (and, for new customers,
// name and email). Signs the customer in.
export const POST = route(async (req) => {
  const body = await readJson(req, schema);
  const user = await userFromSetupToken(body.setup_token);
  if (!user) throw unauthorized("That took too long. Please start again.");

  const isNew = !user.passwordHash;
  if (isNew && (!body.name || !body.email)) {
    return Response.json({ message: "Enter your name and email." }, { status: 422 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(body.password),
      phoneVerifiedAt: user.phoneVerifiedAt ?? new Date(),
      ...(isNew ? { name: body.name, email: body.email } : {}),
    },
  });
  return Response.json({ token: await signToken(updated), user: publicUser(updated) }, { status: isNew ? 201 : 200 });
});
