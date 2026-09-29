import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { storeJson } from "@/lib/catalog";

export const GET = route(async () => {
  const stores = await db.store.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  return Response.json(stores.map(storeJson));
});

const storeSchema = z.object({
  name: z.string().trim().min(1).max(255),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  delivery_radius_km: z.number().positive().max(100).default(10),
});

export const POST = route(async (req) => {
  await requireAdmin(req);
  const data = await readJson(req, storeSchema);
  const store = await db.store.create({
    data: { name: data.name, latitude: data.latitude, longitude: data.longitude, deliveryRadiusKm: data.delivery_radius_km },
  });
  return Response.json(storeJson(store), { status: 201 });
});
