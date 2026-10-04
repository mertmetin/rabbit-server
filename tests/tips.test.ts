import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { POST as placeOrder } from "@/app/api/orders/route";
import { POST as confirm } from "@/app/api/orders/[id]/confirm/route";
import { POST as rate } from "@/app/api/orders/[id]/rating/route";
import { PUT as setStatus } from "@/app/api/driver/status/route";
import { GET as driverOrders } from "@/app/api/driver/orders/route";
import { POST as accept } from "@/app/api/driver/orders/[id]/accept/route";
import { POST as shopped } from "@/app/api/driver/orders/[id]/shopped/route";
import { POST as pickup } from "@/app/api/driver/orders/[id]/pickup/route";
import { POST as deliver } from "@/app/api/driver/orders/[id]/deliver/route";
import { makeCatalog, makeUser } from "./factories";
import { call } from "./helpers";

// A fake Stripe recording holds, captures and off-session tip charges.
const stripeState = {
  created: [] as { amount: number; capture_method?: string; off_session?: boolean; payment_method?: string }[],
  captured: [] as number[],
  declineTips: false,
};
vi.mock("@/lib/stripe", async () => {
  const { default: Stripe } = await import("stripe");
  return {
    stripeCustomerId: async () => "cus_test",
    stripe: () => ({
      paymentMethods: { retrieve: async (id: string) => ({ id, customer: "cus_test" }) },
      paymentIntents: {
        create: async (args: { amount: number; capture_method?: string; off_session?: boolean; payment_method?: string }) => {
          if (args.off_session && stripeState.declineTips) {
            throw new Stripe.errors.StripeCardError({ type: "card_error", message: "Your card was declined." });
          }
          stripeState.created.push(args);
          return { id: `pi_${stripeState.created.length}`, client_secret: "secret", status: args.off_session ? "succeeded" : "requires_capture" };
        },
        retrieve: async (id: string) => ({ id, status: "requires_capture", payment_method: "pm_card" }),
        capture: async (id: string, { amount_to_capture }: { amount_to_capture: number }) => {
          stripeState.captured.push(amount_to_capture);
          return { id, status: "succeeded" };
        },
        cancel: async () => ({}),
      },
    }),
  };
});

beforeEach(() => Object.assign(stripeState, { created: [], captured: [], declineTips: false }));

// A first order (free delivery) of 6 x $3.99 apples with a $3 tip.
async function tippedOrder(tipCents = 300) {
  const catalog = await makeCatalog();
  const customer = await makeUser();
  const driver = await makeUser({ role: "driver" });
  const address = await db.userAddress.create({
    data: { userId: customer.user.id, addressLine1: "110 Laurier Ave W", city: "Ottawa", provinceCode: "ON", latitude: 45.4208, longitude: -75.6975 },
  });
  const placed = await call(placeOrder, {
    token: customer.token,
    body: { payment_method_id: "pm_card", store_id: catalog.centre.id, address_id: address.id, tip_cents: tipCents, items: [{ product_id: catalog.apples.id, quantity: 6 }] },
  });
  const id = placed.body.order.id;
  await call(confirm, { token: customer.token, params: { id } });
  await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: catalog.centre.id } });
  const accepted = await call(accept, { token: driver.token, params: { id } });
  return { id, customer, driver, placed, accepted };
}

async function deliverIt(id: number, driver: { token: string }, itemId: number, found = 6) {
  await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: itemId, found_quantity: found }] } });
  await call(pickup, { token: driver.token, params: { id } });
  await db.order.update({ where: { id }, data: { deliveryPhoto: `orders/${id}/doorstep.jpg` } }); // every delivery has a photo
  await call(deliver, { token: driver.token, params: { id } });
}

describe("tips", () => {
  it("adds the checkout tip to the hold and shows it to the driver", async () => {
    const { placed, accepted } = await tippedOrder();
    expect(placed.body.order).toMatchObject({ subtotal: 23.94, tip: 3, total: 26.94 });
    expect(stripeState.created[0]).toMatchObject({ amount: 2694, capture_method: "manual" });
    expect(accepted.body.tip).toBe(3);
  });

  it("keeps the whole tip when items are missing", async () => {
    const { id, driver, accepted } = await tippedOrder();
    await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: accepted.body.items[0].id, found_quantity: 2 }] } });
    expect(stripeState.captured).toEqual([798 + 300]); // 2 x $3.99 + $3 tip
  });

  it("rejects tips over $100", async () => {
    const catalog = await makeCatalog();
    const customer = await makeUser();
    const address = await db.userAddress.create({
      data: { userId: customer.user.id, addressLine1: "1 Main", city: "Ottawa", provinceCode: "ON", latitude: 45.4208, longitude: -75.6975 },
    });
    const res = await call(placeOrder, {
      token: customer.token,
      body: { payment_method_id: "pm_card", store_id: catalog.centre.id, address_id: address.id, tip_cents: 10_001, items: [{ product_id: catalog.apples.id, quantity: 6 }] },
    });
    expect(res.status).toBe(422);
  });
});

describe("rating after delivery", () => {
  it("rates once, charging an extra tip to the same card", async () => {
    const { id, customer, driver, accepted } = await tippedOrder();
    // Not before it's delivered.
    expect((await call(rate, { token: customer.token, params: { id }, body: { stars: 5 } })).status).toBe(409);
    await deliverIt(id, driver, accepted.body.items[0].id);

    const res = await call(rate, { token: customer.token, params: { id }, body: { stars: 5, comment: "Super fast!", extra_tip_cents: 200 } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rating: 5, rating_comment: "Super fast!", tip: 3, extra_tip: 2 });
    expect(stripeState.created[1]).toMatchObject({ amount: 200, off_session: true, payment_method: "pm_card" });

    // The driver sees both tips; and it can't be rated twice.
    const { body } = await call(driverOrders, { method: "GET", token: driver.token });
    expect(body.mine).toEqual([]); // delivered orders leave the driver's list
    expect((await db.order.findUniqueOrThrow({ where: { id } })).extraTipCents).toBe(200);
    expect((await call(rate, { token: customer.token, params: { id }, body: { stars: 4 } })).status).toBe(409);
  });

  it("rating without an extra tip doesn't charge anything", async () => {
    const { id, customer, driver, accepted } = await tippedOrder(0);
    await deliverIt(id, driver, accepted.body.items[0].id);
    const res = await call(rate, { token: customer.token, params: { id }, body: { stars: 3 } });
    expect(res.body).toMatchObject({ rating: 3, extra_tip: 0 });
    expect(stripeState.created).toHaveLength(1); // only the order's hold
  });

  it("a declined extra tip saves nothing, so the customer can try again", async () => {
    const { id, customer, driver, accepted } = await tippedOrder();
    await deliverIt(id, driver, accepted.body.items[0].id);
    stripeState.declineTips = true;
    const res = await call(rate, { token: customer.token, params: { id }, body: { stars: 5, extra_tip_cents: 500 } });
    expect(res.status).toBe(402);
    expect((await db.order.findUniqueOrThrow({ where: { id } })).ratedAt).toBeNull();
  });
});
