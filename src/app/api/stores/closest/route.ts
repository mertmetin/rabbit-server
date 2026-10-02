import { z } from "zod";
import { db } from "@/lib/db";
import { distanceKm } from "@/lib/geo";
import { route } from "@/lib/http";
import { storeJson } from "@/lib/catalog";
import { etaMinutes, ordersAhead } from "@/lib/eta";

const querySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

// Nearest store that delivers to this point, or null if none does, with a
// delivery time estimate for the home screen.
export const GET = route(async (req) => {
  const params = new URL(req.url).searchParams;
  const { lat, lng } = querySchema.parse(Object.fromEntries(params));

  const stores = await db.store.findMany({ where: { active: true } });
  const inRange = stores
    .map((store) => ({ store, km: distanceKm(lat, lng, Number(store.latitude), Number(store.longitude)) }))
    .filter(({ store, km }) => km <= Number(store.deliveryRadiusKm))
    .sort((a, b) => a.km - b.km);

  const nearest = inRange[0];
  if (!nearest) return Response.json(null);
  const eta = etaMinutes(nearest.km, await ordersAhead(nearest.store.id));
  return Response.json({
    ...storeJson(nearest.store),
    distance_km: Math.round(nearest.km * 10) / 10,
    eta_min: eta.min,
    eta_max: eta.max,
  });
});
