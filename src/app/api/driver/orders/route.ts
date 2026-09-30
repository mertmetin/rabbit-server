import { db } from "@/lib/db";
import { AVAILABLE_STATUSES, driverOrderJson, requireDriver } from "@/lib/driver";
import { route } from "@/lib/http";

// The driver's current deliveries, and orders at their store waiting for a driver.
export const GET = route(async (req) => {
  const driver = await requireDriver(req);
  const include = { items: true, user: true, store: true } as const;

  const [mine, available] = await Promise.all([
    db.order.findMany({
      where: { driverId: driver.id, status: { in: ["placed", "preparing", "ready", "out_for_delivery"] } },
      include,
      orderBy: { placedAt: "asc" },
    }),
    driver.driverOnline && driver.driverStoreId
      ? db.order.findMany({
          where: { storeId: driver.driverStoreId, driverId: null, status: { in: [...AVAILABLE_STATUSES] } },
          include,
          orderBy: { placedAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return Response.json({ mine: mine.map(driverOrderJson), available: available.map(driverOrderJson) });
});
