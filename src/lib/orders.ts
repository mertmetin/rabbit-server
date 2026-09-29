import { z } from "zod";
import type { Order, OrderItem, Prisma } from "@/generated/prisma/client";
import { ApiError, badRequest, notFound } from "./http";
import { taxCents } from "./tax";
import { distanceKm } from "./geo";
import { db } from "./db";
import { stripe } from "./stripe";

export const MIN_ORDER_CENTS = Number(process.env.MIN_ORDER_CENTS ?? 2000);

export const basketSchema = z.object({
  store_id: z.number().int().positive(),
  address_id: z.number().int().positive(),
  items: z
    .array(z.object({ product_id: z.number().int().positive(), quantity: z.number().int().min(1).max(99) }))
    .min(1, "Your basket is empty."),
});

type Tx = Prisma.TransactionClient;

// Prices a basket from the database (never from the client) and checks stock.
export async function priceBasket(tx: Tx, storeId: number, items: { product_id: number; quantity: number }[], provinceCode: string) {
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
  const tax = taxCents(taxable, provinceCode);
  return { lines, subtotal, tax, total: subtotal + tax };
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
    delivery_fee: 0,
    total: order.totalCents / 100,
    items: order.items.map((i) => ({
      product_id: i.productId,
      title: i.title,
      unit_price: i.unitPriceCents / 100,
      quantity: i.quantity,
      line_total: (i.unitPriceCents * i.quantity) / 100,
    })),
    placed_at: order.placedAt,
    created_at: order.createdAt,
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
