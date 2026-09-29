import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { advanceOrder, cancelOrderAsAdmin, dashboardStats, saveProduct, setStock } from "@/lib/admin";
import { makeCatalog, makeUser } from "./factories";

const refunds: string[] = [];
vi.mock("@/lib/stripe", () => ({
  stripe: () => ({
    paymentIntents: { retrieve: async (id: string) => ({ id, status: "succeeded" }), cancel: async () => ({}) },
    refunds: { create: async ({ payment_intent }: { payment_intent: string }) => { refunds.push(payment_intent); return {}; } },
  }),
}));

async function placedOrder() {
  const { centre, apples } = await makeCatalog();
  const { user } = await makeUser();
  const order = await db.order.create({
    data: {
      userId: user.id, storeId: centre.id, status: "placed", placedAt: new Date(), deliveryAddress: {},
      subtotalCents: 1197, taxCents: 0, totalCents: 1197, stripePaymentIntentId: "pi_admin",
      items: { create: [{ productId: apples.id, title: "Apples", unitPriceCents: 399, quantity: 3, taxable: false }] },
    },
  });
  // Stock was reserved when the order was placed.
  await db.inventory.update({ where: { storeId_productId: { storeId: centre.id, productId: apples.id } }, data: { quantity: 17 } });
  return { order, centre, apples };
}

describe("admin: orders", () => {
  it("moves an order through preparing, out for delivery, delivered", async () => {
    const { order } = await placedOrder();
    expect(await advanceOrder(order.id)).toBe("preparing");
    expect(await advanceOrder(order.id)).toBe("out_for_delivery");
    expect(await advanceOrder(order.id)).toBe("delivered");
    await expect(advanceOrder(order.id)).rejects.toThrow(/can't move forward/);
  });

  it("cancels with a refund and puts the stock back", async () => {
    const { order, centre, apples } = await placedOrder();
    await advanceOrder(order.id); // preparing: staff can still cancel
    const cancelled = await cancelOrderAsAdmin(order.id);
    expect(cancelled.status).toBe("cancelled");
    expect(refunds).toContain("pi_admin");
    const stock = await db.inventory.findUniqueOrThrow({ where: { storeId_productId: { storeId: centre.id, productId: apples.id } } });
    expect(stock.quantity).toBe(20);
  });

  it("won't cancel a delivered order", async () => {
    const { order } = await placedOrder();
    for (let i = 0; i < 3; i++) await advanceOrder(order.id);
    await expect(cancelOrderAsAdmin(order.id)).rejects.toThrow(/Delivered/);
  });

  it("counts today's orders and sales, and flags low stock", async () => {
    await placedOrder();
    const stats = await dashboardStats();
    expect(stats).toMatchObject({ ordersToday: 1, revenueTodayCents: 1197, activeOrders: 1 });
    // Bananas and Baguette are at 0 in the test catalogue; Carrots at 5.
    expect(stats.lowStock.map((r) => r.product.title).sort()).toEqual(["Baguette", "Bananas", "Carrots"]);
  });
});

describe("admin: products and stock", () => {
  it("creates and edits a product, storing the price in cents", async () => {
    const { fruit } = await makeCatalog();
    const created = await saveProduct(null, {
      title: "Pears, 2 lb", description: "Bartlett pears", price: "4.49", categoryId: String(fruit.id),
      image: "https://images.test/pears.jpg", taxable: false,
    });
    expect(created.priceCents).toBe(449);

    const edited = await saveProduct(created.id, {
      title: "Pears, 2 lb", description: "", price: "3.99", categoryId: String(fruit.id),
      image: "https://images.test/pears.jpg", taxable: true,
    });
    expect(edited).toMatchObject({ id: created.id, priceCents: 399, taxable: true });
  });

  it("rejects bad product input", async () => {
    const { fruit } = await makeCatalog();
    const base = { title: "X", description: "", price: "1", categoryId: String(fruit.id), image: "https://i.test/x.jpg", taxable: false };
    await expect(saveProduct(null, { ...base, price: "0" })).rejects.toThrow();
    await expect(saveProduct(null, { ...base, image: "not a link" })).rejects.toThrow();
    await expect(saveProduct(null, { ...base, categoryId: "99999" })).rejects.toThrow(/category/);
  });

  it("sets stock per store, creating rows for newly carried products", async () => {
    const { east, apples, baguette } = await makeCatalog();
    await setStock(east.id, { [apples.id]: 12, [baguette.id]: 0 });
    const rows = await db.inventory.findMany({ where: { storeId: east.id }, orderBy: { productId: "asc" } });
    expect(rows.map((r) => [r.productId, r.quantity])).toEqual([[apples.id, 12], [baguette.id, 0]]);
  });
});
