import { describe, expect, it } from "vitest";
import { GET as closest } from "@/app/api/stores/closest/route";
import { GET as categories } from "@/app/api/stores/[id]/categories/route";
import { GET as products } from "@/app/api/stores/[id]/products/route";
import { GET as search } from "@/app/api/search/route";
import { POST as setStock } from "@/app/api/inventory/route";
import { POST as createStore } from "@/app/api/stores/route";
import { makeCatalog, makeUser } from "./factories";
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
