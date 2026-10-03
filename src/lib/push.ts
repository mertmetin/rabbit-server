import { db } from "./db";

// Push notifications through Expo's push service (exp.host), which delivers
// to Apple (and later Google). Phones register their Expo push token with
// POST /api/user/push-token. PUSH_PROVIDER=log prints instead of sending
// (development without a phone). Sending never fails the request it's part of.
export type Push = { title: string; body: string; data?: Record<string, unknown> };

const EXPO_URL = "https://exp.host/--/api/v2/push/send";

async function deliver(tokens: string[], push: Push) {
  if (tokens.length === 0) return;
  if (process.env.PUSH_PROVIDER === "log") {
    console.log(`[push] ${push.title}: ${push.body} -> ${tokens.length} phone(s)`, push.data ?? "");
    return;
  }
  for (let i = 0; i < tokens.length; i += 100) {
    const batch = tokens.slice(i, i + 100);
    const res = await fetch(EXPO_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(batch.map((to) => ({ to, sound: "default", title: push.title, body: push.body, data: push.data }))),
    });
    const json = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
    // Phones that uninstalled the app or turned notifications off: forget them.
    const gone = (json.data ?? []).map((t, j) => (t.details?.error === "DeviceNotRegistered" ? batch[j] : null)).filter(Boolean) as string[];
    if (gone.length) await db.pushToken.deleteMany({ where: { token: { in: gone } } });
  }
}

async function send(where: { userId?: number | { in: number[] }; app: string }, push: Push) {
  try {
    const tokens = await db.pushToken.findMany({ where, select: { token: true } });
    await deliver(tokens.map((t) => t.token), push);
  } catch (err) {
    console.error("Push failed", err);
  }
}

// To a customer's phones (the Rabbit app).
export const pushCustomer = (userId: number, push: Push) => send({ userId, app: "customer" }, push);

// To drivers' phones (the Rabbit Driver app).
export const pushDrivers = (userIds: number[], push: Push) =>
  userIds.length ? send({ userId: { in: userIds }, app: "driver" }, push) : Promise.resolve();
