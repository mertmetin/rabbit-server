import { z } from "zod";
import { db } from "./db";
import { storeJson } from "./catalog";
import { estimate, TYPICAL_PRODUCTS } from "./eta";
import { distanceKm } from "./geo";

// A branch is open for orders while at least one driver is online there:
// the driver app's "You're online" switch opens and closes it. Set
// ORDERING_NEEDS_DRIVER=false to take orders regardless.
export const orderingNeedsDriver = () => process.env.ORDERING_NEEDS_DRIVER !== "false";

export async function openStoreIds(): Promise<Set<number> | null> {
  if (!orderingNeedsDriver()) return null; // null: every active branch is open
  const drivers = await db.user.findMany({
    where: { driverOnline: true, role: { in: ["driver", "admin"] }, driverStoreId: { not: null } },
    select: { driverStoreId: true },
  });
  return new Set(drivers.map((d) => d.driverStoreId!));
}

export async function isStoreOpen(storeId: number) {
  const open = await openStoreIds();
  return open === null || open.has(storeId);
}

// The branch that serves a point: the nearest open one whose delivery radius
// covers it. `farther` means a nearer branch is closed right now, so the order
// comes from farther away (the delivery time accounts for it). When every
// branch covering the point is closed, the nearest one with `open: false`;
// null when none covers it at all.
export async function servingBranch(lat: number, lng: number, products = TYPICAL_PRODUCTS) {
  const stores = await db.store.findMany({ where: { active: true } });
  const inRange = stores
    .map((store) => ({ store, km: distanceKm(lat, lng, Number(store.latitude), Number(store.longitude)) }))
    .filter(({ store, km }) => km <= Number(store.deliveryRadiusKm))
    .sort((a, b) => a.km - b.km);
  if (inRange.length === 0) return null;

  const open = await openStoreIds();
  const isOpen = (id: number) => open === null || open.has(id);
  const serving = inRange.find(({ store }) => isOpen(store.id));
  if (!serving) {
    return { ...storeJson(inRange[0].store), distance_km: Math.round(inRange[0].km * 10) / 10, open: false };
  }

  const eta = await estimate(serving.store, serving.km, products);
  return {
    ...storeJson(serving.store),
    distance_km: Math.round(serving.km * 10) / 10,
    open: true,
    farther: serving !== inRange[0],
    eta_min: eta.min,
    eta_max: eta.max,
  };
}

// Query string for servingBranch: a point and the basket's product count.
export const pointSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  // Different products in the basket, for the delivery time; a typical
  // basket when empty.
  products: z.coerce.number().int().min(0).max(200).optional(),
});
