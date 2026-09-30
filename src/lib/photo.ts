import type { Order } from "@/generated/prisma/client";
import { loadFile } from "./storage";
import { notFound } from "./http";

const CONTENT_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", heic: "image/heic" };

export async function photoResponse(order: Order) {
  if (!order.deliveryPhoto) throw notFound("No photo for this order.");
  const data = await loadFile(order.deliveryPhoto);
  if (!data) throw notFound("No photo for this order.");
  const ext = order.deliveryPhoto.split(".").pop() ?? "jpg";
  return new Response(new Uint8Array(data), {
    headers: { "content-type": CONTENT_TYPES[ext] ?? "application/octet-stream", "cache-control": "private, max-age=86400" },
  });
}
