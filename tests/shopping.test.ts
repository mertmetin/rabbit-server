import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { POST as placeOrder } from "@/app/api/orders/route";
import { POST as confirm } from "@/app/api/orders/[id]/confirm/route";
import { POST as cancel } from "@/app/api/orders/[id]/cancel/route";
import { PUT as setStatus } from "@/app/api/driver/status/route";
import { POST as accept } from "@/app/api/driver/orders/[id]/accept/route";
import { POST as shopped } from "@/app/api/driver/orders/[id]/shopped/route";
import { POST as pickup } from "@/app/api/driver/orders/[id]/pickup/route";
import { makeCatalog, makeUser } from "./factories";
import { call } from "./helpers";

// A fake Stripe that authorizes (manual capture) and records what's charged.
const stripeState = {
  created: [] as { amount: number; capture_method?: string }[],
  captured: [] as { id: string; amount: number }[],
  cancelled: [] as string[],
};
vi.mock("@/lib/stripe", () => ({
  stripeCustomerId: async () => "cus_test",
  stripe: () => ({
    paymentMethods: { retrieve: async (id: string) => ({ id, customer: "cus_test" }) },
    paymentIntents: {
      create: async (args: { amount: number; capture_method?: string }) => {
        stripeState.created.push(args);
        return { id: `pi_${stripeState.created.length}`, client_secret: "secret", status: "requires_capture" };
      },
      retrieve: async (id: string) => ({ id, status: stripeState.captured.some((c) => c.id === id) ? "succeeded" : "requires_capture" }),
      capture: async (id: string, { amount_to_capture }: { amount_to_capture: number }) => {
        stripeState.captured.push({ id, amount: amount_to_capture });
        return { id, status: "succeeded" };
      },
      cancel: async (id: string) => { stripeState.cancelled.push(id); return {}; },
    },
    refunds: { create: async () => { throw new Error("an authorized order should be voided, not refunded"); } },
  }),
}));

beforeEach(() => Object.assign(stripeState, { created: [], captured: [], cancelled: [] }));

// A customer's paid (authorized) order, already taken by a driver.
async function shoppingOrder(items: { product: "apples" | "carrots"; quantity: number }[], opts: { taxableCarrots?: boolean; pastOrder?: boolean } = {}) {
  const catalog = await makeCatalog();
  if (opts.taxableCarrots) await db.product.update({ where: { id: catalog.carrots.id }, data: { taxable: true } });
  const customer = await makeUser();
  const driver = await makeUser({ role: "driver" });
  const address = await db.userAddress.create({
    data: { userId: customer.user.id, addressLine1: "110 Laurier Ave W", city: "Ottawa", provinceCode: "ON", latitude: 45.4208, longitude: -75.6975 },
  });
  if (opts.pastOrder) {
    await db.order.create({ data: { userId: customer.user.id, storeId: catalog.centre.id, status: "delivered", deliveryAddress: {}, subtotalCents: 2500, taxCents: 0, totalCents: 2500 } });
  }
  const placed = await call(placeOrder, {
    token: customer.token,
    body: {
      payment_method_id: "pm_card", store_id: catalog.centre.id, address_id: address.id, substitutions: "skip",
      items: items.map((i) => ({ product_id: catalog[i.product].id, quantity: i.quantity })),
    },
  });
  const id = placed.body.order.id;
  await call(confirm, { token: customer.token, params: { id } });
  await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: catalog.centre.id } });
  const accepted = await call(accept, { token: driver.token, params: { id } });
  const itemId = (title: string) => accepted.body.items.find((i: { title: string }) => i.title.startsWith(title)).id;
  return { id, customer, driver, accepted, itemId, placed };
}

describe("charge after shopping", () => {
  it("authorizes the card at checkout without charging it", async () => {
    const { placed, accepted } = await shoppingOrder([{ product: "apples", quantity: 6 }]);
    expect(stripeState.created).toEqual([expect.objectContaining({ amount: 2394, capture_method: "manual" })]);
    expect(placed.body.order).toMatchObject({ charged: false, substitutions: "skip" });
    expect(accepted.body).toMatchObject({ status: "preparing", substitutions: "skip", charged: false });
    expect(stripeState.captured).toEqual([]);
  });

  it("charges only what was found, with HST recalculated, and keeps the delivery fee", async () => {
    // Not a first order: $3.99 delivery. 6 x $3.99 apples + 3 x $2.29 taxable carrots.
    const { id, driver, accepted, itemId } = await shoppingOrder(
      [{ product: "apples", quantity: 6 }, { product: "carrots", quantity: 3 }], { taxableCarrots: true, pastOrder: true },
    );
    // 23.94 + 6.87 + 3.99, plus HST on the carrots and their share of the fee: (687 + 399*687/3081) * 13% = 1.01
    expect(accepted.body.total).toBe(35.81);

    // Only 4 apples and 1 carrot in the store.
    const res = await call(shopped, {
      token: driver.token, params: { id },
      body: { items: [{ id: itemId("Apples"), found_quantity: 4 }, { id: itemId("Carrots"), found_quantity: 1 }] },
    });
    expect(res.status).toBe(200);
    // 15.96 + 2.29 = 18.25; HST on 2.29 and on the taxable share of the fee: (229 + 399*229/1825) * 13% = 0.36
    expect(res.body).toMatchObject({ status: "ready", charged: true, total: 22.60 });
    expect(stripeState.captured).toEqual([{ id: "pi_1", amount: 2260 }]);

    const order = await db.order.findUniqueOrThrow({ where: { id }, include: { items: true } });
    expect(order).toMatchObject({ subtotalCents: 1825, deliveryFeeCents: 399, taxCents: 36, totalCents: 2260 });
    expect(order.items.map((i) => i.foundQuantity).sort()).toEqual([1, 4]);
  });

  it("free delivery earned at checkout stays free when items are missing", async () => {
    const { id, driver, itemId } = await shoppingOrder([{ product: "apples", quantity: 11 }], { pastOrder: true }); // $43.89, free delivery
    const res = await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: itemId("Apples"), found_quantity: 5 }] } });
    expect(res.body.total).toBe(19.95);
    expect(stripeState.captured).toEqual([{ id: "pi_1", amount: 1995 }]);
  });

  it("nothing found: cancels the order and releases the hold", async () => {
    const { id, driver, itemId } = await shoppingOrder([{ product: "apples", quantity: 6 }]);
    const res = await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: itemId("Apples"), found_quantity: 0 }] } });
    expect(res.body.status).toBe("cancelled");
    expect(stripeState.captured).toEqual([]);
    expect(stripeState.cancelled).toEqual(["pi_1"]);
  });

  it("rejects impossible counts, charges once, and can't be taken out before shopping", async () => {
    const { id, driver, itemId } = await shoppingOrder([{ product: "apples", quantity: 6 }]);
    expect((await call(pickup, { token: driver.token, params: { id } })).status).toBe(409);
    expect((await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: itemId("Apples"), found_quantity: 7 }] } })).status).toBe(400);

    await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: itemId("Apples"), found_quantity: 6 }] } });
    const again = await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: itemId("Apples"), found_quantity: 6 }] } });
    expect(again.status).toBe(409);
    expect(stripeState.captured).toHaveLength(1);
    expect((await call(pickup, { token: driver.token, params: { id } })).body.status).toBe("out_for_delivery");
  });

  it("the customer can't cancel once their order is being shopped", async () => {
    const { id, customer } = await shoppingOrder([{ product: "apples", quantity: 6 }]);
    expect((await call(cancel, { token: customer.token, params: { id } })).status).toBe(409);
  });
});
