import Stripe from "stripe";
import type { User } from "@/generated/prisma/client";
import { db } from "./db";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
    client = new Stripe(key);
  }
  return client;
}

// The user's Stripe customer (created on first checkout), which keeps their saved cards.
export async function stripeCustomerId(user: User): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: user.email ?? undefined,
    phone: `+1${user.phone}`,
    name: user.name || undefined,
    metadata: { user_id: String(user.id) },
  });
  await db.user.update({ where: { id: user.id }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}
