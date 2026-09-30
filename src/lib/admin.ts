import { z } from "zod";
import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "./db";
import { ApiError, notFound } from "./http";
import { cancelOrder } from "./orders";
import { normalizePhone } from "./phone";

// The order lifecycle staff move orders through.
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  placed: "preparing",
  preparing: "ready",
  ready: "out_for_delivery", // normally done by the driver's "Picked up"
  out_for_delivery: "delivered",
};

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  placed: "New",
  preparing: "Preparing",
  ready: "Ready for pickup",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const ACTIVE_STATUSES: OrderStatus[] = ["placed", "preparing", "ready", "out_for_delivery"];
export const LOW_STOCK = 5;

export async function advanceOrder(orderId: number) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) throw notFound("Order not found.");
  const next = NEXT_STATUS[order.status];
  if (!next) throw new ApiError(409, `A ${STATUS_LABEL[order.status].toLowerCase()} order can't move forward.`);
  // Conditional update: two staff clicking at once can't skip a step.
  const stamps = next === "out_for_delivery" ? { pickedUpAt: new Date() } : next === "delivered" ? { deliveredAt: new Date() } : {};
  const { count } = await db.order.updateMany({ where: { id: orderId, status: order.status }, data: { status: next, ...stamps } });
  if (count === 0) throw new ApiError(409, "This order was just updated by someone else.");
  return next;
}

export async function cancelOrderAsAdmin(orderId: number) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw notFound("Order not found.");
  if (order.status === "delivered") throw new ApiError(409, "Delivered orders can't be cancelled.");
  return cancelOrder(order);
}

export const productSchema = z.object({
  title: z.string().trim().min(1, "Name is required.").max(191),
  description: z.string().trim().max(5000).default(""),
  price: z.coerce.number().positive("Price must be more than $0.").max(10_000),
  categoryId: z.coerce.number().int().positive("Choose a category."),
  image: z.url("Image must be a full https:// link.").max(1000),
  taxable: z.boolean(),
});

export async function saveProduct(id: number | null, input: z.input<typeof productSchema>) {
  const data = productSchema.parse(input);
  const category = await db.productCategory.findUnique({ where: { id: data.categoryId } });
  if (!category) throw notFound("That category doesn't exist.");

  const fields = {
    title: data.title,
    description: data.description,
    priceCents: Math.round(data.price * 100),
    categoryId: data.categoryId,
    image: data.image,
    taxable: data.taxable,
  };
  return id ? db.product.update({ where: { id }, data: fields }) : db.product.create({ data: fields });
}

// Sets stock levels for one store: { productId: quantity }.
export async function setStock(storeId: number, quantities: Record<number, number>) {
  const store = await db.store.findUnique({ where: { id: storeId } });
  if (!store) throw notFound("Store not found.");
  await db.$transaction(
    Object.entries(quantities).map(([productId, quantity]) => {
      const q = Math.max(0, Math.floor(quantity));
      return db.inventory.upsert({
        where: { storeId_productId: { storeId, productId: Number(productId) } },
        create: { storeId, productId: Number(productId), quantity: q },
        update: { quantity: q },
      });
    }),
  );
}

export async function dashboardStats(now = new Date()) {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [today, active, lowStock] = await Promise.all([
    db.order.aggregate({
      where: { placedAt: { gte: startOfDay }, status: { notIn: ["cancelled", "pending_payment"] } },
      _count: true,
      _sum: { totalCents: true },
    }),
    db.order.count({ where: { status: { in: ACTIVE_STATUSES } } }),
    db.inventory.findMany({
      where: { quantity: { lte: LOW_STOCK } },
      include: { product: true, store: true },
      orderBy: { quantity: "asc" },
      take: 10,
    }),
  ]);

  return {
    ordersToday: today._count,
    revenueTodayCents: today._sum.totalCents ?? 0,
    activeOrders: active,
    lowStock,
  };
}

// Makes a phone number a driver (new or existing account). They sign in to
// the driver app with that number and an SMS code.
export async function addDriver(phoneInput: string, name: string) {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new ApiError(400, "Enter a 10-digit phone number.");
  const existing = await db.user.findUnique({ where: { phone } });
  if (existing?.role === "admin") throw new ApiError(409, "That number belongs to an admin.");
  return db.user.upsert({
    where: { phone },
    update: { role: "driver", ...(name.trim() && !existing?.name ? { name: name.trim() } : {}) },
    create: { phone, name: name.trim(), role: "driver" },
  });
}

export async function removeDriver(userId: number) {
  const active = await db.order.count({ where: { driverId: userId, status: { in: ["placed", "preparing", "ready", "out_for_delivery"] } } });
  if (active > 0) throw new ApiError(409, "This driver still has deliveries in progress.");
  await db.user.updateMany({ where: { id: userId, role: "driver" }, data: { role: "customer", driverOnline: false, driverStoreId: null } });
}
