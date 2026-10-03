import { z } from "zod";
import { db } from "@/lib/db";
import { distanceKm } from "@/lib/geo";
import { route } from "@/lib/http";
import { storeJson } from "@/lib/catalog";
import { estimate, TYPICAL_PRODUCTS } from "@/lib/eta";
import { openStoreIds } from "@/lib/stores";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  // Different products in the basket, for the delivery time; a typical
  // basket when empty.
  products: z.coerce.number().int().min(0).max(200).optional(),
});

// The branch that serves this point: the nearest open one whose delivery
// radius covers it. `farther` means a nearer branch is closed right now, so
// the order comes from farther away (the delivery time accounts for it).
// When every branch covering the point is closed, the nearest one comes back
// with `open: false`; null when none covers it at all.
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const { lat, lng, products } = querySchema.parse(Object.fromEntries(params));

  const stores = await db.store.findMany({ where: { active: true } });
  const inRange = stores
    .map((store) => ({ store, km: distanceKm(lat, lng, Number(store.latitude), Number(store.longitude)) }))
    .filter(({ store, km }) => km <= Number(store.deliveryRadiusKm))
    .sort((a, b) => a.km - b.km);
  if (inRange.length === 0) return Response.json(null);

  const open = await openStoreIds();
  const isOpen = (id: number) => open === null || open.has(id);
  const serving = inRange.find(({ store }) => isOpen(store.id));
  if (!serving) {
    return Response.json({ ...storeJson(inRange[0].store), distance_km: Math.round(inRange[0].km * 10) / 10, open: false });
  }

  const eta = await estimate(serving.store, serving.km, products || TYPICAL_PRODUCTS);
  return Response.json({
    ...storeJson(serving.store),
    distance_km: Math.round(serving.km * 10) / 10,
    open: true,
    farther: serving !== inRange[0],
    eta_min: eta.min,
    eta_max: eta.max,
  });
});
