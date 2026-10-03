import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";

const schema = z.object({
  token: z.string().regex(/^(Exponent|Expo)PushToken\[.+\]$/, "Not an Expo push token."),
  app: z.enum(["customer", "driver"]).default("customer"),
});

// This phone gets the signed-in user's notifications (moving it from whoever
// was signed in on it before).
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { token, app } = await readJson(req, schema);
  await db.pushToken.upsert({ where: { token }, update: { userId: user.id, app }, create: { userId: user.id, token, app } });
  return new Response(null, { status: 204 });
});

// Signing out: this phone stops getting that user's notifications.
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  const { token } = await readJson(req, schema.pick({ token: true }));
  await db.pushToken.deleteMany({ where: { token, userId: user.id } });
  return new Response(null, { status: 204 });
});
