import { z } from "zod";
import type { Order, OrderItem, Prisma } from "@/generated/prisma/client";
import { ApiError, badRequest, notFound } from "./http";
import { taxCents } from "./tax";
import { distanceKm } from "./geo";
import { db } from "./db";
import { deliveryFee, isFirstOrder } from "./delivery";
import { sendSms } from "./sms";
import { stripe } from "./stripe";

export const basketSchema = z.object({
  store_id: z.number().int().positive(),
  address_id: z.number().int().positive(),
  items: z
    .array(z.object({ product_id: z.number().int().positive(), quantity: z.number().int().min(1).max(99) }))
    .min(1, "Your basket is empty."),
});

type Tx = Prisma.TransactionClient;

// Prices a basket from the database (never from the client) and checks stock,
// including this customer's delivery fee.
export async function priceBasket(tx: Tx, userId: number, storeId: number, items: { product_id: number; quantity: number }[], provinceCode: string) {
  const merged = new Map<number, number>();
  for (const { product_id, quantity } of items) merged.set(product_id, (merged.get(product_id) ?? 0) + quantity);

  const stock = await tx.inventory.findMany({
    where: { storeId, productId: { in: [...merged.keys()] } },
    include: { product: true },
  });
  const byProduct = new Map(stock.map((row) => [row.productId, row]));

  const lines = [...merged].map(([productId, quantity]) => {
    const row = byProduct.get(productId);
    if (!row || row.quantity <= 0) throw new ApiError(409, "Something in your basket is no longer available.");
    if (row.quantity < quantity) {
      throw new ApiError(409, `Only ${row.quantity} left of ${row.product.title}.`);
    }
    return {
      productId,
      title: row.product.title,
      unitPriceCents: row.product.priceCents,
      quantity,
      taxable: row.product.taxable,
    };
  });

  const subtotal = lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const taxable = lines.filter((l) => l.taxable).reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
  const delivery = deliveryFee(subtotal, await isFirstOrder(tx, userId));
  // The delivery fee is taxed like what it delivers: in proportion to the
  // taxable share of the basket (basic groceries are zero-rated).
  // To be confirmed by an accountant before launch.
  const taxableFee = subtotal > 0 ? (delivery.cents * taxable) / subtotal : 0;
  const tax = taxCents(taxable + taxableFee, provinceCode);
  return { lines, subtotal, tax, delivery, total: subtotal + delivery.cents + tax };
}

// The user's address, and the store, checked to be able to deliver to it.
export async function deliveryContext(tx: Tx, userId: number, storeId: number, addressId: number) {
  const address = await tx.userAddress.findFirst({ where: { id: addressId, userId } });
  if (!address) throw notFound("Choose a delivery address.");
  const store = await tx.store.findFirst({ where: { id: storeId, active: true } });
  if (!store) throw notFound("This store isn't available.");

  const km = distanceKm(Number(address.latitude), Number(address.longitude), Number(store.latitude), Number(store.longitude));
  if (km > Number(store.deliveryRadiusKm)) throw badRequest(`${store.name} doesn't deliver to this address.`);
  return { address, store };
}

// Puts reserved stock back (order cancelled or payment abandoned).
export async function restock(tx: Tx, order: Order & { items: OrderItem[] }) {
  for (const item of order.items) {
    await tx.inventory.updateMany({
      where: { storeId: order.storeId, productId: item.productId },
      data: { quantity: { increment: item.quantity } },
    });
  }
}

export function orderJson(order: Order & { items: OrderItem[] }) {
  return {
    id: order.id,
    status: order.status,
    store_id: order.storeId,
    delivery_address: order.deliveryAddress,
    notes: order.notes,
    contactless: order.contactless,
    no_bell: order.noBell,
    subtotal: order.subtotalCents / 100,
    tax: order.taxCents / 100,
    delivery_fee: order.deliveryFeeCents / 100,
    total: order.totalCents / 100,
    items: order.items.map((i) => ({
      product_id: i.productId,
      title: i.title,
      unit_price: i.unitPriceCents / 100,
      quantity: i.quantity,
      line_total: (i.unitPriceCents * i.quantity) / 100,
    })),
    placed_at: order.placedAt,
    picked_up_at: order.pickedUpAt,
    delivered_at: order.deliveredAt,
    has_photo: Boolean(order.deliveryPhoto),
    created_at: order.createdAt,
    // Only while this order is on its way.
    driver_location:
      order.status === "out_for_delivery" && order.driverLatitude !== null && order.driverLongitude !== null
        ? { latitude: Number(order.driverLatitude), longitude: Number(order.driverLongitude), updated_at: order.driverLocatedAt }
        : null,
  };
}

// Cancels an order: refunds (or voids) its payment and puts the stock back.
export async function cancelOrder(order: Order & { items: OrderItem[] }) {
  if (order.status === "cancelled") return order;

  if (order.stripePaymentIntentId) {
    const intent = await stripe().paymentIntents.retrieve(order.stripePaymentIntentId);
    if (intent.status === "succeeded") {
      await stripe().refunds.create({ payment_intent: intent.id });
    } else if (intent.status !== "canceled") {
      await stripe().paymentIntents.cancel(intent.id);
    }
  }

  return db.$transaction(async (tx) => {
    await restock(tx, order);
    return tx.order.update({ where: { id: order.id }, data: { status: "cancelled" }, include: { items: true } });
  });
}

// Marks an order paid (idempotent): used by the app's confirm call and the
// Stripe webhook, whichever arrives first. Whoever gets there first also
// sends the new-order alert, so it goes out once.
export async function markPaid(orderId: number) {
  const { count } = await db.order.updateMany({
    where: { id: orderId, status: "pending_payment" },
    data: { status: "placed", placedAt: new Date() },
  });
  if (count === 1) await alertNewOrder(orderId);
}

// Texts ORDER_ALERT_PHONES (comma-separated) about a new paid order, so it's
// seen even with the driver app closed. Never fails the payment it follows.
async function alertNewOrder(orderId: number) {
  const phones = (process.env.ORDER_ALERT_PHONES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (phones.length === 0) return;
  try {
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const items = order.items.reduce((sum, i) => sum + i.quantity, 0);
    const address = order.deliveryAddress as { address_line_1?: string } | null;
    const text =
      `🐰 New Rabbit order #${order.id}: $${(order.totalCents / 100).toFixed(2)}, ${items} item${items === 1 ? "" : "s"}` +
      `${address?.address_line_1 ? `, to ${address.address_line_1}` : ""}. Open Rabbit Driver to accept.`;
    await Promise.all(phones.map((phone) => sendSms(phone, text)));
  } catch (err) {
    console.error("New-order alert failed", err);
  }
}

export const ABANDONED_AFTER_MS = 30 * 60 * 1000;

// Cancels checkouts that were never paid and puts their stock back. Stripe
// payments still open on them are voided so they can't complete later.
export async function releaseAbandonedOrders(now = new Date(), storeId?: number) {
  const stale = await db.order.findMany({
    where: {
      status: "pending_payment",
      createdAt: { lt: new Date(now.getTime() - ABANDONED_AFTER_MS) },
      ...(storeId ? { storeId } : {}),
    },
    include: { items: true },
    take: 50,
  });
  for (const order of stale) {
    await cancelOrder(order).catch((err) => console.error(`[orders] couldn't release #${order.id}:`, err));
  }
  return stale.length;
}
