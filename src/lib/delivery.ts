import type { Prisma } from "@/generated/prisma/client";

// Delivery pricing: a customer's first order is delivered free, after that a
// flat fee unless the basket is big enough. Amounts in cents; the env
// variables override the defaults without a code change.
export const MIN_ORDER_CENTS = Number(process.env.MIN_ORDER_CENTS ?? 2000);
export const DELIVERY_FEE_CENTS = Number(process.env.DELIVERY_FEE_CENTS ?? 499);
export const FREE_DELIVERY_OVER_CENTS = Number(process.env.FREE_DELIVERY_OVER_CENTS ?? 4000);

export type DeliveryReason = "first_order" | "over_threshold" | "standard";

// A first order is one placed before any other paid order (abandoned or
// cancelled checkouts don't count).
export async function isFirstOrder(tx: Prisma.TransactionClient, userId: number) {
  const earlier = await tx.order.count({ where: { userId, status: { notIn: ["pending_payment", "cancelled"] } } });
  return earlier === 0;
}

export function deliveryFee(subtotalCents: number, firstOrder: boolean): { cents: number; reason: DeliveryReason } {
  if (firstOrder) return { cents: 0, reason: "first_order" };
  if (subtotalCents >= FREE_DELIVERY_OVER_CENTS) return { cents: 0, reason: "over_threshold" };
  return { cents: DELIVERY_FEE_CENTS, reason: "standard" };
}
