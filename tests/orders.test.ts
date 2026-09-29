import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as quote } from "@/app/api/orders/quote/route";
import { GET as listOrders, POST as placeOrder } from "@/app/api/orders/route";
import { POST as confirm } from "@/app/api/orders/[id]/confirm/route";
import { POST as cancel } from "@/app/api/orders/[id]/cancel/route";
import { makeCatalog, makeUser } from "./factories";
import { call } from "./helpers";

// A fake Stripe: payments "succeed" unless a test says otherwise.
const stripeState = { status: "succeeded", refunds: 0, created: 0, fail: false };
vi.mock("@/lib/stripe", () => ({
  stripeCustomerId: async () => "cus_test",
  stripe: () => ({
    paymentIntents: {
      create: async ({ amount }: { amount: number }) => {
        if (stripeState.fail) throw new Error("stripe down");
        stripeState.created++;
        return { id: `pi_${stripeState.created}`, client_secret: `secret_${amount}` };
      },
      retrieve: async (id: string) => ({ id, status: stripeState.status }),
      cancel: async () => ({}),
    },
    ephemeralKeys: { create: async () => ({ secret: "ek_test" }) },
    refunds: { create: async () => { stripeState.refunds++; return {}; } },
  }),
}));

beforeEach(() => Object.assign(stripeState, { status: "succeeded", refunds: 0, created: 0, fail: false }));

async function setup(province = "ON") {
  const catalog = await makeCatalog();
  const { user, token } = await makeUser();
  const address = await db.userAddress.create({
    data: {
      userId: user.id, addressLine1: "110 Laurier Ave W", city: "Ottawa", provinceCode: province,
      latitude: 45.4208, longitude: -75.6975,
    },
  });
  return { ...catalog, user, token, address };
}

const stockOf = async (storeId: number, productId: number) =>
  (await db.inventory.findUniqueOrThrow({ where: { storeId_productId: { storeId, productId } } })).quantity;

describe("checkout", () => {
  it("prices the basket on the server, taxing only taxable items", async () => {
    const { centre, apples, carrots, token, address } = await setup();
    await db.product.update({ where: { id: carrots.id }, data: { taxable: true } });

    // 5 x $3.99 apples (zero-rated) + 2 x $2.29 carrots (taxable, 13% HST)
    const res = await call(quote, {
      token,
      body: { store_id: centre.id, address_id: address.id, items: [
        { product_id: apples.id, quantity: 5 }, { product_id: carrots.id, quantity: 2 },
      ] },
    });
    expect(res.body).toEqual({
      subtotal: 24.53, tax: 0.6, delivery_fee: 0, total: 25.13, min_order: 20, meets_minimum: true,
    });
  });

  it("places an order, reserves stock, and marks it placed once paid", async () => {
    const { centre, apples, token, address } = await setup();
    const res = await call(placeOrder, {
      token,
      body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }], contactless: true },
    });
    expect(res.status).toBe(201);
    expect(res.body.order).toMatchObject({ status: "pending_payment", total: 23.94, contactless: true });
    expect(res.body.payment).toMatchObject({ client_secret: "secret_2394", ephemeral_key: "ek_test" });
    expect(await stockOf(centre.id, apples.id)).toBe(14);

    // Not visible in history until paid.
    expect((await call(listOrders, { method: "GET", token })).body).toEqual([]);

    const confirmed = await call(confirm, { token, params: { id: res.body.order.id } });
    expect(confirmed.body.status).toBe("placed");
    expect((await call(listOrders, { method: "GET", token })).body).toHaveLength(1);
  });

  it("won't place an order below the $20 minimum", async () => {
    const { centre, apples, token, address } = await setup();
    const res = await call(placeOrder, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 1 }] },
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minimum/);
    expect(await stockOf(centre.id, apples.id)).toBe(20);
  });

  it("refuses more than the store has, and items it doesn't carry", async () => {
    const { centre, apples, baguette, token, address } = await setup();
    const tooMany = await call(placeOrder, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 21 }] },
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.message).toMatch(/Only 20 left/);

    const soldOut = await call(quote, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: baguette.id, quantity: 9 }] },
    });
    expect(soldOut.status).toBe(409);
  });

  it("won't deliver from a store outside its radius", async () => {
    const { centre, apples, token, user } = await setup();
    const toronto = await db.userAddress.create({
      data: { userId: user.id, addressLine1: "1 Yonge St", city: "Toronto", provinceCode: "ON", latitude: 43.6426, longitude: -79.3747 },
    });
    const res = await call(quote, {
      token, body: { store_id: centre.id, address_id: toronto.id, items: [{ product_id: apples.id, quantity: 6 }] },
    });
    expect(res.status).toBe(400);
  });

  it("doesn't place an order whose payment failed", async () => {
    const { centre, apples, token, address } = await setup();
    const { body } = await call(placeOrder, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] },
    });
    stripeState.status = "requires_payment_method";
    const res = await call(confirm, { token, params: { id: body.order.id } });
    expect(res.status).toBe(402);
  });

  it("releases stock if Stripe is unavailable", async () => {
    const { centre, apples, token, address } = await setup();
    stripeState.fail = true;
    const res = await call(placeOrder, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] },
    });
    expect(res.status).toBe(502);
    expect(await stockOf(centre.id, apples.id)).toBe(20);
  });

  it("cancelling refunds the payment and restocks", async () => {
    const { centre, apples, token, address } = await setup();
    const { body } = await call(placeOrder, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] },
    });
    await call(confirm, { token, params: { id: body.order.id } });

    const res = await call(cancel, { token, params: { id: body.order.id } });
    expect(res.body.status).toBe("cancelled");
    expect(stripeState.refunds).toBe(1);
    expect(await stockOf(centre.id, apples.id)).toBe(20);
  });

  it("keeps orders private to their customer", async () => {
    const { centre, apples, token, address } = await setup();
    const other = await makeUser();
    const { body } = await call(placeOrder, {
      token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] },
    });
    expect((await call(confirm, { token: other.token, params: { id: body.order.id } })).status).toBe(404);
    expect((await call(cancel, { token: other.token, params: { id: body.order.id } })).status).toBe(404);
    // Someone else's address can't be used either.
    const res = await call(quote, {
      token: other.token, body: { store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] },
    });
    expect(res.status).toBe(404);
  });
});
