import { db } from "./db";

// Rough delivery time while orders are shopped and delivered by hand:
// shopping, then the drive (city pace plus parking and walking up), plus
// time for orders already ahead in the queue. A cautious range rounded to
// 5 minutes; arriving early beats arriving late. Replace with measured
// averages once there's real order history.
const SHOPPING_MIN = 25;
const MIN_PER_KM = 3;
const HANDOVER_MIN = 5;
const PER_ORDER_AHEAD_MIN = 15;

export function etaMinutes(distanceKm: number, ordersAhead: number) {
  const expected = SHOPPING_MIN + distanceKm * MIN_PER_KM + HANDOVER_MIN + ordersAhead * PER_ORDER_AHEAD_MIN;
  const min = Math.max(30, Math.round(expected / 5) * 5);
  return { min, max: min + 30 };
}

// Paid orders at this store that haven't left yet. Only recent ones: an order
// forgotten in "preparing" shouldn't slow every estimate down forever.
const QUEUE_WINDOW_MS = 3 * 60 * 60 * 1000;

export function ordersAhead(storeId: number, now = new Date()) {
  return db.order.count({
    where: { storeId, status: { in: ["placed", "preparing", "ready"] }, placedAt: { gte: new Date(now.getTime() - QUEUE_WINDOW_MS) } },
  });
}
