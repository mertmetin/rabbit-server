import { z } from "zod";
import { db } from "@/lib/db";
import { distanceKm } from "@/lib/geo";
import { route } from "@/lib/http";
import { storeJson } from "@/lib/catalog";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// Nearest store that delivers to this point, or null if none does.
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const { lat, lng } = querySchema.parse(Object.fromEntries(params));

  const stores = await db.store.findMany({ where: { active: true } });
  const inRange = stores
    .map((store) => ({ store, km: distanceKm(lat, lng, Number(store.latitude), Number(store.longitude)) }))
    .filter(({ store, km }) => km <= Number(store.deliveryRadiusKm))
    .sort((a, b) => a.km - b.km);

  const nearest = inRange[0];
  return Response.json(nearest ? { ...storeJson(nearest.store), distance_km: Math.round(nearest.km * 10) / 10 } : null);
});
