import { db } from "@/lib/db";
import { AVAILABLE_STATUSES, MAX_ACTIVE_DELIVERIES, driverOrderJson, findDriverOrder, requireDriver, transition } from "@/lib/driver";
import { ApiError, idParam, route } from "@/lib/http";

// Take an order. First driver to accept gets it.
export const POST = route(async (req, ctx: RouteContext<"/api/driver/orders/[id]/accept">) => {
  const driver = await requireDriver(req);
  const order = await findDriverOrder(driver, await idParam(ctx));
  if (!driver.driverOnline || driver.driverStoreId !== order.storeId) {
    throw new ApiError(409, `Go online at ${order.store.name} to take its orders.`);
  }
  const active = await db.order.count({ where: { driverId: driver.id, status: { in: ["placed", "preparing", "ready", "out_for_delivery"] } } });
  if (active >= MAX_ACTIVE_DELIVERIES) throw new ApiError(409, `You can carry up to ${MAX_ACTIVE_DELIVERIES} orders at a time.`);

  await transition(
    order.id,
    { driverId: null, status: { in: [...AVAILABLE_STATUSES] } },
    // A paid order goes to "preparing": the customer sees it's being shopped
    // and can no longer cancel it.
    { driverId: driver.id, ...(order.status === "placed" ? { status: "preparing" as const } : {}) },
    "Another driver just took this order.",
  );
  return Response.json(driverOrderJson(await findDriverOrder(driver, order.id)));
});
