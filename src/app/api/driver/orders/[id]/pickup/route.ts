import { driverOrderJson, findDriverOrder, requireDriver, transition } from "@/lib/driver";
import { ApiError, idParam, route } from "@/lib/http";

// Collected from the store: the customer now sees "On the way".
export const POST = route(async (req, ctx: RouteContext<"/api/driver/orders/[id]/pickup">) => {
  const driver = await requireDriver(req);
  const order = await findDriverOrder(driver, await idParam(ctx));
  if (order.driverId !== driver.id) throw new ApiError(403, "This isn't your order.");
  if (order.status !== "ready") throw new ApiError(409, "The store hasn't marked this order ready yet.");

  await transition(order.id, { driverId: driver.id, status: "ready" }, { status: "out_for_delivery", pickedUpAt: new Date() }, "This order was just updated. Refresh and try again.");
  return Response.json(driverOrderJson(await findDriverOrder(driver, order.id)));
});
