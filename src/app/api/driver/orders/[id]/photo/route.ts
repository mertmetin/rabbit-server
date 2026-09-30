import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { findDriverOrder, requireDriver } from "@/lib/driver";
import { ApiError, badRequest, idParam, route } from "@/lib/http";
import { saveFile } from "@/lib/storage";

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic" };

// The driver's photo of where they left the order (form field "photo").
export const POST = route(async (req, ctx: RouteContext<"/api/driver/orders/[id]/photo">) => {
  const driver = await requireDriver(req);
  const order = await findDriverOrder(driver, await idParam(ctx));
  if (order.driverId !== driver.id) throw new ApiError(403, "This isn't your order.");
  if (order.status !== "out_for_delivery" && order.status !== "delivered") {
    throw new ApiError(409, "Take the photo when you drop the order off.");
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File)) throw badRequest("Attach a photo.");
  const ext = TYPES[file.type];
  if (!ext) throw badRequest("The photo must be a JPEG, PNG or HEIC image.");
  if (file.size > MAX_BYTES) throw badRequest("That photo is too large (8 MB max).");

  const key = `delivery-photos/${order.id}-${randomUUID()}.${ext}`;
  await saveFile(key, Buffer.from(await file.arrayBuffer()));
  await db.order.update({ where: { id: order.id }, data: { deliveryPhoto: key } });
  return Response.json({ has_photo: true }, { status: 201 });
});
