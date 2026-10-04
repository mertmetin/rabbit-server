import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { POST as placeOrder } from "@/app/api/orders/route";
import { POST as confirm } from "@/app/api/orders/[id]/confirm/route";
import { POST as register, DELETE as unregister } from "@/app/api/user/push-token/route";
import { PUT as setStatus } from "@/app/api/driver/status/route";
import { POST as accept } from "@/app/api/driver/orders/[id]/accept/route";
import { POST as shopped } from "@/app/api/driver/orders/[id]/shopped/route";
import { POST as pickup } from "@/app/api/driver/orders/[id]/pickup/route";
import { POST as deliver } from "@/app/api/driver/orders/[id]/deliver/route";
import { makeCatalog, makeUser } from "./factories";
import { call } from "./helpers";
import { sentPushes } from "./setup";

vi.mock("@/lib/stripe", () => ({
  stripeCustomerId: async () => "cus_test",
  stripe: () => ({
    paymentMethods: { retrieve: async (id: string) => ({ id, customer: "cus_test" }) },
    paymentIntents: {
      create: async () => ({ id: "pi_1", client_secret: "s", status: "requires_capture" }),
      retrieve: async (id: string) => ({ id, status: "requires_capture" }),
      capture: async () => ({ status: "succeeded" }),
      cancel: async () => ({}),
    },
  }),
}));

describe("push tokens", () => {
  it("registers a phone for the signed-in user, moves it on sign-in, and removes it on sign-out", async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const token = "ExponentPushToken[abc123]";
    expect((await call(register, { token: alice.token, body: { token } })).status).toBe(204);
    expect((await db.pushToken.findUniqueOrThrow({ where: { token } })).userId).toBe(alice.user.id);

    await call(register, { token: bob.token, body: { token, app: "driver" } });
    expect(await db.pushToken.findUniqueOrThrow({ where: { token } })).toMatchObject({ userId: bob.user.id, app: "driver" });

    await call(unregister, { method: "DELETE", token: bob.token, body: { token } });
    expect(await db.pushToken.count()).toBe(0);
    expect((await call(register, { token: alice.token, body: { token: "not-a-token" } })).status).toBe(422);
  });
});

describe("order notifications", () => {
  it("tells drivers about a new order and the customer about every step", async () => {
    const { centre, apples, carrots } = await makeCatalog();
    const customer = await makeUser();
    const driver = await makeUser({ role: "driver" });
    const offline = await makeUser({ role: "driver" });
    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: centre.id } });
    const address = await db.userAddress.create({
      data: { userId: customer.user.id, addressLine1: "110 Laurier Ave W", city: "Ottawa", provinceCode: "ON", latitude: 45.4208, longitude: -75.6975 },
    });

    const placed = await call(placeOrder, {
      token: customer.token,
      body: { payment_method_id: "pm_card", store_id: centre.id, address_id: address.id, items: [
        { product_id: apples.id, quantity: 6 }, { product_id: carrots.id, quantity: 2 },
      ] },
    });
    const id = placed.body.order.id;
    await call(confirm, { token: customer.token, params: { id } });
    // Only the online driver at that branch.
    expect(sentPushes).toEqual([expect.objectContaining({ to: "drivers", userIds: [driver.user.id], title: `🐰 New order #${id}`, data: { order_id: id } })]);
    expect(sentPushes[0].userIds).not.toContain(offline.user.id);

    const accepted = await call(accept, { token: driver.token, params: { id } });
    const carrotsLine = accepted.body.items.find((i: { title: string }) => i.title.startsWith("Carrots"));
    const applesLine = accepted.body.items.find((i: { title: string }) => i.title.startsWith("Apples"));
    await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: applesLine.id, found_quantity: 6 }, { id: carrotsLine.id, found_quantity: 0 }] } });
    await call(pickup, { token: driver.token, params: { id } });
    await db.order.update({ where: { id }, data: { deliveryPhoto: `orders/${id}/doorstep.jpg` } }); // every delivery has a photo
    await call(deliver, { token: driver.token, params: { id } });

    const toCustomer = sentPushes.filter((p) => p.to === "customer");
    expect(toCustomer.every((p) => p.userIds[0] === customer.user.id && p.data?.order_id === id)).toBe(true);
    expect(toCustomer.map((p) => p.title)).toEqual(["🛒 We're preparing your order", "✅ Your order is ready", "🐰 On the way!", "Delivered 🎉"]);
    expect(toCustomer[1].body).toBe("2 items weren't available, so you weren't charged for them. Total: $23.94.");
    expect(toCustomer[2].body).toMatch(/about \d+ min/);
    expect(toCustomer[3].data).toMatchObject({ rate: true });
  });

  it("tells the customer when nothing could be found", async () => {
    const { centre, apples } = await makeCatalog();
    const customer = await makeUser();
    const driver = await makeUser({ role: "driver" });
    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: centre.id } });
    const address = await db.userAddress.create({
      data: { userId: customer.user.id, addressLine1: "1 Main", city: "Ottawa", provinceCode: "ON", latitude: 45.4208, longitude: -75.6975 },
    });
    const placed = await call(placeOrder, { token: customer.token, body: { payment_method_id: "pm_card", store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] } });
    const id = placed.body.order.id;
    await call(confirm, { token: customer.token, params: { id } });
    const accepted = await call(accept, { token: driver.token, params: { id } });
    await call(shopped, { token: driver.token, params: { id }, body: { items: [{ id: accepted.body.items[0].id, found_quantity: 0 }] } });
    expect(sentPushes.at(-1)).toMatchObject({ to: "customer", title: "Sorry, we couldn't find your items", body: "Your order was cancelled and you weren't charged." });
  });
});
