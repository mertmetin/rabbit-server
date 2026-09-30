import { z } from "zod";
import { db } from "@/lib/db";
import { requireDriver } from "@/lib/driver";
import { readJson, route } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) });

// The driver's position, saved only on orders they're carrying right now,
// so customers see it only while their order is on the way.
export const POST = route(async (req) => {
  const driver = await requireDriver(req);
  rateLimit(`driver-location:${driver.id}`, 60, 60 * 1000);
  const { latitude, longitude } = await readJson(req, schema);

  const { count } = await db.order.updateMany({
    where: { driverId: driver.id, status: "out_for_delivery" },
    data: { driverLatitude: latitude, driverLongitude: longitude, driverLocatedAt: new Date() },
  });
  return Response.json({ tracking: count > 0 });
});
