import type { Order, OrderItem, Store } from "@/generated/prisma/client";
import { db } from "./db";
import { drivingMinutes } from "./eta";
import { distanceKm } from "./geo";
import { pushCustomer, pushDrivers } from "./push";

// What customers and drivers are told as an order moves along. Tapping a
// notification opens the order (data.order_id).
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const forOrder = (order: Order) => ({ order_id: order.id });

// Paid: tell the drivers online at that branch.
export async function newOrderForDrivers(order: Order & { items: OrderItem[] }) {
  const drivers = await db.user.findMany({
    where: { driverOnline: true, driverStoreId: order.storeId, role: { in: ["driver", "admin"] } },
    select: { id: true },
  });
  const items = order.items.reduce((n, i) => n + i.quantity, 0);
  await pushDrivers(drivers.map((d) => d.id), {
    title: `🐰 New order #${order.id}`,
    body: `${money(order.totalCents)} · ${items} item${items === 1 ? "" : "s"}. Tap to accept.`,
    data: forOrder(order),
  });
}

export const preparing = (order: Order) =>
  pushCustomer(order.userId, { title: "🛒 We're preparing your order", body: "We're getting everything on your list.", data: forOrder(order) });

// After shopping: what was charged, and what wasn't there.
export function shopped(order: Order & { items: OrderItem[] }) {
  const missing = order.items.reduce((n, i) => n + (i.quantity - (i.foundQuantity ?? i.quantity)), 0);
  const body = missing
    ? `${missing} item${missing === 1 ? " wasn't" : "s weren't"} available, so you weren't charged for ${missing === 1 ? "it" : "them"}. Total: ${money(order.totalCents)}.`
    : `Everything was found. Total: ${money(order.totalCents)}. It'll be on its way shortly.`;
  return pushCustomer(order.userId, { title: "✅ Your order is ready", body, data: forOrder(order) });
}

export function nothingFound(order: Order) {
  return pushCustomer(order.userId, {
    title: "Sorry, we couldn't find your items",
    body: "Your order was cancelled and you weren't charged.",
    data: forOrder(order),
  });
}

export function onTheWay(order: Order & { store: Store }) {
  const to = order.deliveryAddress as { latitude?: number; longitude?: number } | null;
  const km = to?.latitude != null && to?.longitude != null
    ? distanceKm(Number(order.store.latitude), Number(order.store.longitude), Number(to.latitude), Number(to.longitude))
    : 3;
  const minutes = Math.max(5, Math.round(drivingMinutes(km) / 5) * 5);
  return pushCustomer(order.userId, {
    title: "🐰 On the way!",
    body: `Your groceries will be there in about ${minutes} min.`,
    data: forOrder(order),
  });
}

export const delivered = (order: Order) =>
  pushCustomer(order.userId, { title: "Delivered 🎉", body: "Enjoy! Tap to tell us how we did.", data: { ...forOrder(order), rate: true } });
