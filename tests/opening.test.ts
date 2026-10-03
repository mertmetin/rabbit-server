import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET as closest } from "@/app/api/stores/closest/route";
import { GET as stream } from "@/app/api/stores/stream/route";
import { POST as quote } from "@/app/api/orders/quote/route";
import { POST as placeOrder } from "@/app/api/orders/route";
import { PUT as setStatus } from "@/app/api/driver/status/route";
import { makeCatalog, makeUser } from "./factories";
import { call } from "./helpers";

vi.mock("@/lib/stripe", () => ({
  stripeCustomerId: async () => "cus_test",
  stripe: () => ({
    paymentMethods: { retrieve: async (id: string) => ({ id, customer: "cus_test" }) },
    paymentIntents: { create: async () => ({ id: "pi_1", client_secret: "s", status: "requires_capture" }) },
  }),
}));

// Branches open and close with their drivers here (the other test files
// switch this off).
beforeEach(() => { process.env.ORDERING_NEEDS_DRIVER = "true"; });
afterEach(() => { process.env.ORDERING_NEEDS_DRIVER = "false"; });

async function get(path: string) {
  const res = await closest(new Request(`http://test.local${path}`), { params: Promise.resolve({}) } as never);
  return { status: res.status, body: await res.json() };
}

// Centre (45.4215, -75.6972) and East (45.4558, -75.5047), 10 km each.
// Overbrook (45.4300, -75.6250) is 5.7 km from Centre and 9.8 km from East,
// so both cover it; Westboro (45.3920, -75.7590) is only in Centre's.
const OVERBROOK = "/api/stores/closest?lat=45.4300&lng=-75.6250";
const WESTBORO = "/api/stores/closest?lat=45.3920&lng=-75.7590";

describe("branches open with their drivers", () => {
  it("is closed when no driver is online, but still shows its branch", async () => {
    const { centre } = await makeCatalog();
    const res = await get(OVERBROOK);
    expect(res.body).toMatchObject({ id: centre.id, open: false });
    expect(res.body.eta_min).toBeUndefined();
  });

  it("serves from the nearest open branch", async () => {
    const { centre } = await makeCatalog();
    const driver = await makeUser({ role: "driver" });
    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: centre.id } });
    expect((await get(OVERBROOK)).body).toMatchObject({ id: centre.id, open: true, farther: false });
  });

  it("falls back to a farther open branch that also covers the address, with a longer time", async () => {
    const { centre, east } = await makeCatalog();
    const driver = await makeUser({ role: "driver" });
    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: centre.id } });
    const near = (await get(OVERBROOK)).body;

    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: east.id } });
    const far = (await get(OVERBROOK)).body;
    expect(far).toMatchObject({ id: east.id, open: true, farther: true });
    expect(far.eta_min).toBeGreaterThan(near.eta_min);

    // Westboro is outside East's radius: Centre is its only branch, and it's closed.
    expect((await get(WESTBORO)).body).toMatchObject({ id: centre.id, open: false });
  });

  it("refuses orders at a closed branch and says so at checkout", async () => {
    const { centre, apples } = await makeCatalog();
    const customer = await makeUser();
    const address = await db.userAddress.create({
      data: { userId: customer.user.id, addressLine1: "110 Laurier Ave W", city: "Ottawa", provinceCode: "ON", latitude: 45.4208, longitude: -75.6975 },
    });
    const body = { payment_method_id: "pm_card", store_id: centre.id, address_id: address.id, items: [{ product_id: apples.id, quantity: 6 }] };

    expect((await call(quote, { token: customer.token, body })).body.open).toBe(false);
    const refused = await call(placeOrder, { token: customer.token, body });
    expect(refused.status).toBe(409);
    expect(refused.body.message).toMatch(/isn't taking orders right now/);
    expect(await db.order.count()).toBe(0);

    const driver = await makeUser({ role: "driver" });
    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: centre.id } });
    expect((await call(placeOrder, { token: customer.token, body })).status).toBe(201);
  });
});

describe("live branch status (/api/stores/stream)", () => {
  // Reads server-sent events until one arrives (or times out).
  async function nextEvent(reader: ReadableStreamDefaultReader<Uint8Array>, buffer: { text: string }) {
    const decoder = new TextDecoder();
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const end = buffer.text.indexOf("\n\n");
      if (end >= 0) {
        const raw = buffer.text.slice(0, end);
        buffer.text = buffer.text.slice(end + 2);
        if (raw.startsWith(":")) continue; // heartbeat
        const data = raw.split("\n").find((l) => l.startsWith("data: "))!.slice(6);
        return JSON.parse(data);
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("stream ended");
      buffer.text += decoder.decode(value, { stream: true });
    }
    throw new Error("no event");
  }

  it("pushes the branch opening and closing as the driver goes online and offline", async () => {
    const { centre } = await makeCatalog();
    const driver = await makeUser({ role: "driver" });
    const abort = new AbortController();
    const res = await stream(new Request(`http://test.local${OVERBROOK.replace("closest", "stream")}`, { signal: abort.signal }), { params: Promise.resolve({}) } as never);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const buffer = { text: "" };

    expect(await nextEvent(reader, buffer)).toMatchObject({ id: centre.id, open: false });

    await call(setStatus, { method: "PUT", token: driver.token, body: { online: true, store_id: centre.id } });
    expect(await nextEvent(reader, buffer)).toMatchObject({ id: centre.id, open: true, eta_min: expect.any(Number) });

    await call(setStatus, { method: "PUT", token: driver.token, body: { online: false } });
    expect(await nextEvent(reader, buffer)).toMatchObject({ id: centre.id, open: false });

    abort.abort();
    await reader.cancel();
  });
});
