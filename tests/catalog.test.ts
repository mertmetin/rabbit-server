import { describe, expect, it } from "vitest";
import { GET as closest } from "@/app/api/stores/closest/route";
import { GET as categories } from "@/app/api/stores/[id]/categories/route";
import { GET as products } from "@/app/api/stores/[id]/products/route";
import { GET as search } from "@/app/api/search/route";
import { GET as popular } from "@/app/api/stores/[id]/popular/route";
import { GET as variants } from "@/app/api/stores/[id]/products/[productId]/variants/route";
import { POST as setStock } from "@/app/api/inventory/route";
import { POST as createStore } from "@/app/api/stores/route";
import { makeCatalog, makeUser } from "./factories";
import { db } from "@/lib/db";
import { call } from "./helpers";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function get(handler: unknown, url: string, params: Record<string, number> = {}) {
  const res = await (handler as Handler)(new Request(`http://test.local${url}`), {
    params: Promise.resolve(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)]))),
  });
  return { status: res.status, body: await res.json() };
}

describe("closest store", () => {
  it("picks the nearest store, not just any store in range", async () => {
    const { centre, east } = await makeCatalog();
    // Parliament Hill is ~0.5 km from Centre and ~15 km from East; both deliver 10 km.
    expect((await get(closest, "/api/stores/closest?lat=45.4236&lng=-75.7009")).body.id).toBe(centre.id);
    // Orléans is closer to East.
    expect((await get(closest, "/api/stores/closest?lat=45.4700&lng=-75.5100")).body.id).toBe(east.id);
  });

  it("returns null when no store delivers there", async () => {
    await makeCatalog();
    const res = await get(closest, "/api/stores/closest?lat=43.6532&lng=-79.3832"); // Toronto
    expect(res).toEqual({ status: 200, body: null });
  });

  it("rejects missing coordinates", async () => {
    expect((await get(closest, "/api/stores/closest?lat=45.4")).status).toBe(422);
  });
});

describe("store catalogue", () => {
  it("lists only categories with something in stock", async () => {
    const { centre, east, produce, bakery } = await makeCatalog();
    expect((await get(categories, "/", { id: centre.id })).body.map((c: { id: number }) => c.id)).toEqual([produce.id]);
    expect((await get(categories, "/", { id: east.id })).body.map((c: { id: number }) => c.id)).toEqual([bakery.id]);
  });

  it("groups in-stock products by subcategory", async () => {
    const { centre, produce } = await makeCatalog();
    const { body } = await get(products, `/api/stores/${centre.id}/products?category=${produce.id}`, { id: centre.id });
    expect(body).toEqual([
      { id: expect.any(Number), title: "Fruit", data: [expect.objectContaining({ title: "Apples", price: 3.99, price_cents: 399, quantity: 20 })] },
      { id: expect.any(Number), title: "Vegetables", data: [expect.objectContaining({ title: "Carrots" })] },
    ]);
  });

  it("404s for an unknown store", async () => {
    expect((await get(categories, "/", { id: 999 })).status).toBe(404);
  });
});

describe("search", () => {
  it("finds in-stock products at the given store only", async () => {
    const { centre, east } = await makeCatalog();
    const atCentre = await get(search, `/api/search?store_id=${centre.id}&q=bag`);
    const atEast = await get(search, `/api/search?store_id=${east.id}&q=bag`);
    expect(atCentre.body.hits).toEqual([]);
    expect(atEast.body.hits.map((h: { title: string }) => h.title)).toEqual(["Baguette"]);

    const fresh = await get(search, `/api/search?store_id=${centre.id}&q=fresh`);
    expect(fresh.body.hits.map((h: { title: string }) => h.title).sort()).toEqual(["Apples", "Carrots"]);
  });
});

describe("admin-only store management", () => {
  it("lets admins set stock and add stores, but not customers", async () => {
    const { centre, bananas } = await makeCatalog();
    const customer = await makeUser();
    const admin = await makeUser({ role: "admin" });
    const stock = { store_id: centre.id, product_id: bananas.id, quantity: 12 };
    const store = { name: "Kanata", latitude: 45.3088, longitude: -75.8987 };

    expect((await call(setStock, { token: customer.token, body: stock })).status).toBe(403);
    expect((await call(createStore, { token: customer.token, body: store })).status).toBe(403);
    expect((await call(setStock, { body: stock })).status).toBe(401);

    expect((await call(setStock, { token: admin.token, body: stock })).body.quantity).toBe(12);
    expect((await call(createStore, { token: admin.token, body: store })).status).toBe(201);

    const hits = await get(search, `/api/search?store_id=${centre.id}&q=banana`);
    expect(hits.body.hits).toHaveLength(1);
  });
});

describe("popular products", () => {
  it("lists what the store has in stock, best sellers first", async () => {
    const { centre, carrots, apples } = await makeCatalog();
    const { user } = await makeUser();
    const { db } = await import("@/lib/db");
    await db.order.create({
      data: {
        userId: user.id, storeId: centre.id, status: "delivered", deliveryAddress: {},
        subtotalCents: 229, taxCents: 0, totalCents: 229,
        items: { create: [{ productId: carrots.id, title: "Carrots", unitPriceCents: 229, quantity: 3, taxable: false }] },
      },
    });

    const { body } = await get(popular, "/", { id: centre.id });
    expect(body.map((p: { id: number }) => p.id)).toEqual([carrots.id, apples.id]);
  });
});

describe("product variants", () => {
  // Milk at Centre: 2% 4 L (the group's first product), 1% 4 L, and 2% 2 L out of stock.
  async function makeMilk() {
    const catalog = await makeCatalog();
    const { centre, produce } = catalog;
    const group = await db.productGroup.create({
      data: { title: "Milk", options: [{ name: "Milk fat", values: ["1%", "2%"] }, { name: "Size", values: ["2 L", "4 L"] }] },
    });
    const variant = (title: string, priceCents: number, options: Record<string, string>) =>
      db.product.create({ data: { title, description: "Milk", priceCents, categoryId: produce.id, image: "https://img.test/milk.jpg", groupId: group.id, options } });
    const twoFour = await variant("2% milk, 4 L", 649, { "Milk fat": "2%", Size: "4 L" });
    const oneFour = await variant("1% milk, 4 L", 649, { "Milk fat": "1%", Size: "4 L" });
    const twoTwo = await variant("2% milk, 2 L", 479, { "Milk fat": "2%", Size: "2 L" });
    await db.inventory.createMany({
      data: [
        { storeId: centre.id, productId: twoFour.id, quantity: 8 },
        { storeId: centre.id, productId: oneFour.id, quantity: 3 },
        { storeId: centre.id, productId: twoTwo.id, quantity: 0 },
      ],
    });
    return { ...catalog, group, twoFour, oneFour, twoTwo };
  }

  it("lists a group once, as its first in-stock variant with a count", async () => {
    const { centre, produce, group, twoFour } = await makeMilk();
    const { body } = await get(products, `/api/stores/${centre.id}/products?category=${produce.id}`, { id: centre.id });
    const milk = body[0].data.filter((p: { group_id: number | null }) => p.group_id === group.id);
    expect(milk).toEqual([expect.objectContaining({ id: twoFour.id, variant_count: 2, options: { "Milk fat": "2%", Size: "4 L" } })]);
  });

  it("shows a group once among popular products", async () => {
    const { centre, group } = await makeMilk();
    const { body } = await get(popular, "/", { id: centre.id });
    expect(body.filter((p: { group_id: number | null }) => p.group_id === group.id)).toHaveLength(1);
  });

  it("returns the group's options and in-stock variants", async () => {
    const { centre, twoFour, oneFour } = await makeMilk();
    const { body } = await get(variants, "/", { id: centre.id, productId: oneFour.id });
    expect(body.options).toEqual([{ name: "Milk fat", values: ["1%", "2%"] }, { name: "Size", values: ["2 L", "4 L"] }]);
    expect(body.variants.map((v: { id: number }) => v.id)).toEqual([twoFour.id, oneFour.id]);
  });

  it("treats a product outside a group as its only variant", async () => {
    const { centre, apples } = await makeCatalog();
    const { body } = await get(variants, "/", { id: centre.id, productId: apples.id });
    expect(body).toEqual({ options: [], variants: [expect.objectContaining({ id: apples.id, group_id: null })] });
  });
});
