import { driverOrderJson, findDriverOrder, requireDriver, transition } from "@/lib/driver";
import { ApiError, idParam, route } from "@/lib/http";

// Handed over (or left at the door, with a photo): the order is complete and
// live location stops.
export const POST = route(async (req, ctx: RouteContext<"/api/driver/orders/[id]/deliver">) => {
  const driver = await requireDriver(req);
  const order = await findDriverOrder(driver, await idParam(ctx));
  if (order.driverId !== driver.id) throw new ApiError(403, "This isn't your order.");
  if (order.status !== "out_for_delivery") throw new ApiError(409, "Mark the order picked up first.");
  // Left at the door: the photo is the proof of delivery (e.g. if the customer
  // disputes the charge), so it's required.
  if (order.contactless && !order.deliveryPhoto) throw new ApiError(409, "Take a photo of where you left the order first.");

  await transition(
    order.id,
    { driverId: driver.id, status: "out_for_delivery" },
    { status: "delivered", deliveredAt: new Date(), driverLatitude: null, driverLongitude: null, driverLocatedAt: null },
    "This order was just updated. Refresh and try again.",
  );
  return Response.json(driverOrderJson(await findDriverOrder(driver, order.id)));
});
