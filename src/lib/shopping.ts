import type { Order, OrderItem } from "@/generated/prisma/client";
import { db } from "./db";
import { ApiError } from "./http";
import { cancelOrder } from "./orders";
import { stripe } from "./stripe";
import { taxCents } from "./tax";

// After shopping: charge only what was found. The customer never pays more
// than they authorized at checkout, the delivery fee stays what it was then
// (missing items don't add one), and the tip is kept whole. HST is
// recalculated on what's left.
export function finalTotals(order: Order, items: (OrderItem & { foundQuantity: number })[], provinceCode: string) {
  const subtotal = items.reduce((sum, i) => sum + i.unitPriceCents * i.foundQuantity, 0);
  const taxable = items.filter((i) => i.taxable).reduce((sum, i) => sum + i.unitPriceCents * i.foundQuantity, 0);
  const fee = order.deliveryFeeCents;
  const taxableFee = subtotal > 0 ? (fee * taxable) / subtotal : 0;
  const tax = taxCents(taxable + taxableFee, provinceCode);
  // The tip is kept in full, whatever was missing.
  return { subtotal, tax, total: Math.min(subtotal + fee + tax + order.tipCents, order.totalCents) };
}

// `found` maps order item id -> how many were found (0..ordered quantity).
// Nothing found cancels the order and releases the hold.
export async function finishShopping(order: Order & { items: OrderItem[] }, found: Map<number, number>) {
  if (order.capturedAt) throw new ApiError(409, "This order has already been charged.");
  const items = order.items.map((item) => {
    const count = found.get(item.id);
    if (count === undefined) throw new ApiError(400, `Say how many of ${item.title} you found.`);
    if (count < 0 || count > item.quantity) throw new ApiError(400, `${item.title}: found must be between 0 and ${item.quantity}.`);
    return { ...item, foundQuantity: count };
  });

  if (items.every((i) => i.foundQuantity === 0)) return cancelOrder(order);

  const address = order.deliveryAddress as { zone_code?: string } | null;
  const totals = finalTotals(order, items, address?.zone_code ?? "ON");

  if (order.stripePaymentIntentId) {
    await stripe().paymentIntents.capture(order.stripePaymentIntentId, { amount_to_capture: totals.total });
  }

  return db.$transaction(async (tx) => {
    for (const item of items) {
      await tx.orderItem.update({ where: { id: item.id }, data: { foundQuantity: item.foundQuantity } });
    }
    return tx.order.update({
      where: { id: order.id },
      data: { subtotalCents: totals.subtotal, taxCents: totals.tax, totalCents: totals.total, capturedAt: new Date(), status: "ready" },
      include: { items: true },
    });
  });
}
