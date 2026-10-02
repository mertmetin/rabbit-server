import type { Order, OrderItem, Store, User } from "@/generated/prisma/client";
import { requireUser } from "./auth";
import { db } from "./db";
import { ApiError, forbidden, notFound } from "./http";

// Orders a driver at a store can pick up: paid, not yet taken, not on the way.
export const AVAILABLE_STATUSES = ["placed", "preparing", "ready"] as const;
export const MAX_ACTIVE_DELIVERIES = 3;

export async function requireDriver(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== "driver" && user.role !== "admin") throw forbidden();
  return user;
}

type FullOrder = Order & { items: OrderItem[]; user: User; store: Store };

// What a driver needs to deliver an order. The customer's phone is included
// so the driver can call them.
export function driverOrderJson(order: FullOrder) {
  const address = (order.deliveryAddress ?? {}) as Record<string, unknown>;
  return {
    id: order.id,
    status: order.status,
    store: { id: order.store.id, name: order.store.name, latitude: Number(order.store.latitude), longitude: Number(order.store.longitude) },
    customer: { name: order.user.name, phone: order.user.phone },
    address: {
      line1: address.address_line_1 ?? "",
      line2: address.address_line_2 ?? null,
      city: address.city ?? "",
      postal_code: address.postal_code ?? null,
      notes: address.notes ?? null,
      latitude: address.latitude ?? null,
      longitude: address.longitude ?? null,
    },
    notes: order.notes,
    contactless: order.contactless,
    no_bell: order.noBell,
    item_count: order.items.reduce((n, i) => n + i.quantity, 0),
    items: order.items.map((i) => ({
      id: i.id,
      title: i.title,
      quantity: i.quantity,
      unit_price: i.unitPriceCents / 100,
      found_quantity: i.foundQuantity,
    })),
    substitutions: order.substitutions,
    charged: order.capturedAt !== null,
    total: order.totalCents / 100,
    placed_at: order.placedAt,
    picked_up_at: order.pickedUpAt,
    has_photo: Boolean(order.deliveryPhoto),
  };
}

export async function findDriverOrder(driver: User, orderId: number) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true, user: true, store: true } });
  if (!order) throw notFound("Order not found.");
  return order;
}

// Moves an order on only if it's still in the expected state and assigned as
// expected, so two drivers (or a driver and staff) can't clash.
export async function transition(orderId: number, where: object, data: object, conflict: string) {
  const { count } = await db.order.updateMany({ where: { id: orderId, ...where }, data });
  if (count === 0) throw new ApiError(409, conflict);
}
