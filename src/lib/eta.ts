import type { Store } from "@/generated/prisma/client";
import { db } from "./db";
import { distanceKm } from "./geo";

// Delivery time while one person shops and delivers each order in turn:
//
//   this order = orders ahead (each shopped, then a round trip to its
//                customer and back)
//              + shopping this basket
//              + driving here and handing it over
//
// Shopping takes a base (getting to the store, checkout, bagging) plus time
// per different product; driving uses straight-line distance stretched for
// real roads at city speed. Once there's real order history, these numbers
// should become measured averages (orders record placed, shopped, picked-up
// and delivered times).
const SHOP_BASE_MIN = 10;
const SHOP_PER_PRODUCT_MIN = 0.75;
const ROAD_FACTOR = 1.3;
const CITY_KMH = 30;
const HANDOVER_MIN = 5;
// Before there's a basket (home screen), assume a typical order.
export const TYPICAL_PRODUCTS = 10;
// Orders older than this aren't treated as waiting (a forgotten order
// shouldn't slow every estimate down forever).
const QUEUE_WINDOW_MS = 3 * 60 * 60 * 1000;

export const shoppingMinutes = (products: number) => SHOP_BASE_MIN + Math.max(products, 1) * SHOP_PER_PRODUCT_MIN;
export const drivingMinutes = (km: number) => ((km * ROAD_FACTOR) / CITY_KMH) * 60 + HANDOVER_MIN;

type Point = { latitude: number; longitude: number };

// Minutes of work queued at a store: each recent paid order not yet on its
// way, shopped (by its number of products) and delivered, back to the store.
export async function queueMinutes(store: Store, now = new Date()) {
  const orders = await db.order.findMany({
    where: {
      storeId: store.id,
      status: { in: ["placed", "preparing", "ready"] },
      placedAt: { gte: new Date(now.getTime() - QUEUE_WINDOW_MS) },
    },
    select: { status: true, deliveryAddress: true, _count: { select: { items: true } } },
  });
  return orders.reduce((sum, order) => {
    const to = order.deliveryAddress as Partial<Point> | null;
    const km = to?.latitude != null && to?.longitude != null
      ? distanceKm(Number(store.latitude), Number(store.longitude), Number(to.latitude), Number(to.longitude))
      : 3;
    const shopping = order.status === "ready" ? 0 : shoppingMinutes(order._count.items);
    return sum + shopping + 2 * drivingMinutes(km) - HANDOVER_MIN;
  }, 0);
}

// A cautious range for delivering `products` different products to a point
// `km` from the store: rounded to 5 minutes, at least 20 minutes wide (or a
// third of the estimate), never under 25 minutes.
export async function estimate(store: Store, km: number, products = TYPICAL_PRODUCTS) {
  const expected = (await queueMinutes(store)) + shoppingMinutes(products) + drivingMinutes(km);
  const min = Math.max(25, Math.round(expected / 5) * 5);
  const width = Math.max(20, Math.round(expected / 3 / 5) * 5);
  return { min, max: min + width };
}
