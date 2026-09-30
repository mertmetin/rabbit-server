import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { POST as cron } from "@/app/api/cron/release-abandoned/route";
import { releaseAbandonedOrders } from "@/lib/orders";
import { makeCatalog, makeUser } from "./factories";

const cancelled: string[] = [];
vi.mock("@/lib/stripe", () => ({
  stripe: () => ({
    paymentIntents: {
      retrieve: async (id: string) => ({ id, status: "requires_payment_method" }),
      cancel: async (id: string) => { cancelled.push(id); return {}; },
    },
    refunds: { create: async () => ({}) },
  }),
}));

const SECRET = "whsec_test_secret";
beforeEach(() => { process.env.STRIPE_WEBHOOK_SECRET = SECRET; process.env.CRON_SECRET = "cron-secret"; cancelled.length = 0; });
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; delete process.env.CRON_SECRET; });

// A webhook request signed the way Stripe signs them.
function stripeEvent(type: string, intentId: string, secret = SECRET) {
  const payload = JSON.stringify({ id: `evt_${type}`, object: "event", type, data: { object: { id: intentId, object: "payment_intent" } } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return webhook(new Request("http://test.local/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
}

async function pendingOrder(intentId: string, ageMinutes = 0) {
  const { centre, apples } = await makeCatalog();
  const { user } = await makeUser();
  const order = await db.order.create({
    data: {
      userId: user.id, storeId: centre.id, status: "pending_payment", deliveryAddress: {},
      subtotalCents: 2394, taxCents: 0, totalCents: 2394, stripePaymentIntentId: intentId,
      createdAt: new Date(Date.now() - ageMinutes * 60 * 1000),
      items: { create: [{ productId: apples.id, title: "Apples", unitPriceCents: 399, quantity: 6, taxable: false }] },
    },
  });
  // Stock was reserved at checkout.
  await db.inventory.update({ where: { storeId_productId: { storeId: centre.id, productId: apples.id } }, data: { quantity: 14 } });
  const stock = () => db.inventory.findUniqueOrThrow({ where: { storeId_productId: { storeId: centre.id, productId: apples.id } } }).then((i) => i.quantity);
  return { order, stock };
}

describe("Stripe webhook", () => {
  it("places a paid order even if the app never confirmed it", async () => {
    const { order } = await pendingOrder("pi_paid");
    const res = await stripeEvent("payment_intent.succeeded", "pi_paid");
    expect(res.status).toBe(200);
    const updated = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("placed");
    expect(updated.placedAt).not.toBeNull();

    // Stripe can resend events; a second delivery changes nothing.
    await stripeEvent("payment_intent.succeeded", "pi_paid");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).placedAt).toEqual(updated.placedAt);
  });

  it("cancels and restocks when the payment fails", async () => {
    const { order, stock } = await pendingOrder("pi_failed");
    await stripeEvent("payment_intent.payment_failed", "pi_failed");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("cancelled");
    expect(await stock()).toBe(20);
  });

  it("rejects requests that weren't signed by Stripe", async () => {
    const { order } = await pendingOrder("pi_forged");
    const res = await stripeEvent("payment_intent.succeeded", "pi_forged", "whsec_wrong");
    expect(res.status).toBe(400);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending_payment");
  });

  it("ignores events for unknown payments", async () => {
    expect((await stripeEvent("payment_intent.succeeded", "pi_unknown")).status).toBe(200);
  });
});

describe("abandoned checkouts", () => {
  it("releases orders left unpaid for 30 minutes, not newer ones", async () => {
    const old = await pendingOrder("pi_old", 45);
    expect(await releaseAbandonedOrders()).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: old.order.id } })).status).toBe("cancelled");
    expect(await old.stock()).toBe(20);
    expect(cancelled).toEqual(["pi_old"]); // the open payment is voided too
  });

  it("keeps recent unpaid checkouts", async () => {
    const recent = await pendingOrder("pi_recent", 5);
    expect(await releaseAbandonedOrders()).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: recent.order.id } })).status).toBe("pending_payment");
  });

  it("runs from the scheduler only with the cron secret", async () => {
    await pendingOrder("pi_cron", 45);
    const denied = await cron(new Request("http://test.local", { method: "POST" }));
    expect(denied.status).toBe(401);
    const ok = await cron(new Request("http://test.local", { method: "POST", headers: { authorization: "Bearer cron-secret" } }));
    expect(await ok.json()).toEqual({ released: 1 });
  });
});
