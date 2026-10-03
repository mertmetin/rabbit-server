import { z } from "zod";
import { db } from "@/lib/db";
import { requireDriver } from "@/lib/driver";
import { badRequest, readJson, route } from "@/lib/http";
import { branchesChanged } from "@/lib/events";

const storeJson = (s: { id: number; name: string } | null) => (s ? { id: s.id, name: s.name } : null);

export const GET = route(async (req) => {
  const driver = await requireDriver(req);
  const store = driver.driverStoreId ? await db.store.findUnique({ where: { id: driver.driverStoreId } }) : null;
  return Response.json({ online: driver.driverOnline, store: storeJson(store) });
});

// Go online at a store (to see its orders) or offline.
export const PUT = route(async (req) => {
  const driver = await requireDriver(req);
  const { online, store_id } = await readJson(req, z.object({ online: z.boolean(), store_id: z.number().int().positive().optional() }));

  const storeId = store_id ?? driver.driverStoreId;
  if (online && !storeId) throw badRequest("Choose the store you're working from.");
  const store = storeId ? await db.store.findFirst({ where: { id: storeId, active: true } }) : null;
  if (online && !store) throw badRequest("That store isn't available.");

  await db.user.update({ where: { id: driver.id }, data: { driverOnline: online, driverStoreId: store?.id ?? null } });
  branchesChanged(); // open/closed may have changed for customers
  return Response.json({ online, store: storeJson(store) });
});
