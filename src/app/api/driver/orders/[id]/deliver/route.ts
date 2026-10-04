import { driverOrderJson, findDriverOrder, requireDriver, transition } from "@/lib/driver";
import { ApiError, idParam, route } from "@/lib/http";
import { delivered } from "@/lib/order-notifications";

// Handed over or left at the door, with a photo: the order is complete and
// live location stops.
export const POST = route(async (req, ctx: RouteContext<"/api/driver/orders/[id]/deliver">) => {
  const driver = await requireDriver(req);
  const order = await findDriverOrder(driver, await idParam(ctx));
  if (order.driverId !== driver.id) throw new ApiError(403, "This isn't your order.");
  if (order.status !== "out_for_delivery") throw new ApiError(409, "Mark the order picked up first.");
  // Every delivery needs a photo (the bag where it was left or handed over):
  // the proof if a customer ever disputes the charge.
  if (!order.deliveryPhoto) throw new ApiError(409, "Take a photo of the delivered order first.");

  await transition(
    order.id,
    { driverId: driver.id, status: "out_for_delivery" },
    { status: "delivered", deliveredAt: new Date(), driverLatitude: null, driverLongitude: null, driverLocatedAt: null },
    "This order was just updated. Refresh and try again.",
  );
  await delivered(order);
  return Response.json(driverOrderJson(await findDriverOrder(driver, order.id)));
});
