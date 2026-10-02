import { z } from "zod";
import { driverOrderJson, findDriverOrder, requireDriver } from "@/lib/driver";
import { ApiError, idParam, readJson, route } from "@/lib/http";
import { finishShopping } from "@/lib/shopping";

const schema = z.object({
  items: z.array(z.object({ id: z.number().int().positive(), found_quantity: z.number().int().min(0) })).min(1),
});

// Done shopping: how many of each item were found. Charges the customer for
// exactly that and marks the order ready to take out; nothing found cancels
// it and releases the hold.
export const POST = route(async (req, ctx: RouteContext<"/api/driver/orders/[id]/shopped">) => {
  const driver = await requireDriver(req);
  const order = await findDriverOrder(driver, await idParam(ctx));
  if (order.driverId !== driver.id) throw new ApiError(403, "This isn't your order.");
  if (order.status !== "placed" && order.status !== "preparing") {
    throw new ApiError(409, "This order isn't being shopped.");
  }

  const { items } = await readJson(req, schema);
  await finishShopping(order, new Map(items.map((i) => [i.id, i.found_quantity])));
  return Response.json(driverOrderJson(await findDriverOrder(driver, order.id)));
});
