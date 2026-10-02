import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDriver, advanceOrder, removeDriver } from "@/lib/admin";
import { GET as driverStatus, PUT as setStatus } from "@/app/api/driver/status/route";
import { GET as driverOrders } from "@/app/api/driver/orders/route";
import { POST as accept } from "@/app/api/driver/orders/[id]/accept/route";
import { POST as pickup } from "@/app/api/driver/orders/[id]/pickup/route";
import { POST as deliver } from "@/app/api/driver/orders/[id]/deliver/route";
import { POST as shopped } from "@/app/api/driver/orders/[id]/shopped/route";
import { POST as location } from "@/app/api/driver/location/route";
import { GET as customerOrder } from "@/app/api/orders/[id]/route";
import { makeCatalog, makeUser } from "./factories";
import { call } from "./helpers";

async function setup() {
  const catalog = await makeCatalog();
  const customer = await makeUser();
  const driver = await makeUser({ role: "driver" });
  const newOrder = () =>
    db.order.create({
      data: {
        userId: customer.user.id, storeId: catalog.centre.id, status: "placed", placedAt: new Date(),
        deliveryAddress: { address_line_1: "110 Laurier Ave W", city: "Ottawa", latitude: 45.4208, longitude: -75.6975 },
        subtotalCents: 2394, taxCents: 0, totalCents: 2394, notes: "Buzz 12", contactless: true,
        items: { create: [{ productId: catalog.apples.id, title: "Apples", unitPriceCents: 399, quantity: 6, taxable: false }] },
      },
    });
  const goOnline = (token = driver.token) => call(setStatus, { method: "PUT", token, body: { online: true, store_id: catalog.centre.id } });
  return { ...catalog, customer, driver, newOrder, goOnline };
}

describe("driver app", () => {
  it("is only for drivers", async () => {
    const { customer } = await setup();
    expect((await call(driverOrders, { method: "GET", token: customer.token })).status).toBe(403);
    expect((await call(driverOrders, { method: "GET" })).status).toBe(401);
  });

  it("goes online at a store and sees its orders waiting for a driver", async () => {
    const { driver, newOrder, goOnline, centre } = await setup();
    const order = await newOrder();

    expect((await call(driverOrders, { method: "GET", token: driver.token })).body.available).toEqual([]); // offline
    expect((await goOnline()).body).toEqual({ online: true, store: { id: centre.id, name: "Ottawa Centre" } });
    expect((await call(driverStatus, { method: "GET", token: driver.token })).body.online).toBe(true);

    const { body } = await call(driverOrders, { method: "GET", token: driver.token });
    expect(body.available).toHaveLength(1);
    expect(body.available[0]).toMatchObject({
      id: order.id, customer: { phone: expect.any(String) }, address: { line1: "110 Laurier Ave W" },
      notes: "Buzz 12", contactless: true, item_count: 6, total: 23.94,
    });
  });

  it("delivers an order end to end, sharing location only while on the way", async () => {
    const { driver, customer, newOrder, goOnline } = await setup();
    const order = await newOrder();
    await goOnline();

    // Accepting starts the shopping: the customer sees "preparing".
    const accepted = await call(accept, { token: driver.token, params: { id: order.id } });
    expect(accepted.body.status).toBe("preparing");
    // Can't take it out before it's been shopped.
    expect((await call(pickup, { token: driver.token, params: { id: order.id } })).status).toBe(409);
    const done = await call(shopped, { token: driver.token, params: { id: order.id }, body: { items: [{ id: accepted.body.items[0].id, found_quantity: 6 }] } });
    expect(done.body).toMatchObject({ status: "ready", charged: true });

    // Location before pickup isn't stored anywhere.
    expect((await call(location, { token: driver.token, body: { latitude: 45.42, longitude: -75.70 } })).body.tracking).toBe(false);

    expect((await call(pickup, { token: driver.token, params: { id: order.id } })).body.status).toBe("out_for_delivery");
    expect((await call(location, { token: driver.token, body: { latitude: 45.4215, longitude: -75.6990 } })).body.tracking).toBe(true);

    const onTheWay = await call(customerOrder, { method: "GET", token: customer.token, params: { id: order.id } });
    expect(onTheWay.body.status).toBe("out_for_delivery");
    expect(onTheWay.body.driver_location).toMatchObject({ latitude: 45.4215, longitude: -75.699 });
    expect(onTheWay.body.picked_up_at).not.toBeNull();

    // Contactless: no delivering without a doorstep photo.
    const noPhoto = await call(deliver, { token: driver.token, params: { id: order.id } });
    expect(noPhoto.status).toBe(409);
    expect(noPhoto.body.message).toMatch(/photo/);
    await db.order.update({ where: { id: order.id }, data: { deliveryPhoto: `orders/${order.id}/doorstep.jpg` } });
    expect((await call(deliver, { token: driver.token, params: { id: order.id } })).body.status).toBe("delivered");
    const delivered = await call(customerOrder, { method: "GET", token: customer.token, params: { id: order.id } });
    expect(delivered.body.driver_location).toBeNull();
    expect(delivered.body.delivered_at).not.toBeNull();
    expect((await call(driverOrders, { method: "GET", token: driver.token })).body.mine).toEqual([]);
  });

  it("gives an order to the first driver who accepts it", async () => {
    const { driver, newOrder, goOnline } = await setup();
    const other = await makeUser({ role: "driver" });
    const order = await newOrder();
    await goOnline();
    await goOnline(other.token);

    expect((await call(accept, { token: driver.token, params: { id: order.id } })).status).toBe(200);
    const second = await call(accept, { token: other.token, params: { id: order.id } });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/Another driver/);
    // And another driver can't pick up or deliver it.
    expect((await call(pickup, { token: other.token, params: { id: order.id } })).status).toBe(403);
  });

  it("only takes orders from the store the driver is online at, up to 3 at a time", async () => {
    const { driver, newOrder, goOnline } = await setup();
    const first = await newOrder();
    expect((await call(accept, { token: driver.token, params: { id: first.id } })).status).toBe(409); // offline

    await goOnline();
    for (let i = 0; i < 3; i++) {
      const o = await newOrder();
      expect((await call(accept, { token: driver.token, params: { id: o.id } })).status).toBe(200);
    }
    const fourth = await call(accept, { token: driver.token, params: { id: first.id } });
    expect(fourth.status).toBe(409);
    expect(fourth.body.message).toMatch(/up to 3/);
  });
});

describe("admin: drivers", () => {
  it("adds a driver by phone, and removes them when they have no deliveries", async () => {
    const created = await addDriver("(613) 555-0199", "Dan Driver");
    expect(created).toMatchObject({ phone: "6135550199", role: "driver", name: "Dan Driver" });

    const customer = await makeUser();
    const promoted = await addDriver(customer.user.phone, "");
    expect(promoted.role).toBe("driver");

    await removeDriver(created.id);
    expect((await db.user.findUniqueOrThrow({ where: { id: created.id } })).role).toBe("customer");
  });

  it("won't remove a driver who is carrying an order", async () => {
    const { driver, newOrder, goOnline } = await setup();
    const order = await newOrder();
    await goOnline();
    await call(accept, { token: driver.token, params: { id: order.id } });
    await expect(removeDriver(driver.user.id)).rejects.toThrow(/in progress/);
  });
});

describe("delivery photo", () => {
  const upload = (handler: unknown, token: string, id: number, file: File) => {
    const form = new FormData();
    form.append("photo", file);
    const req = new Request("http://test.local/api", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    return (handler as (r: Request, c: unknown) => Promise<Response>)(req, { params: Promise.resolve({ id: String(id) }) });
  };
  const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], "door.jpg", { type: "image/jpeg" });

  it("the driver adds a photo at drop-off; the customer can see it, others can't", async () => {
    const { POST: photo } = await import("@/app/api/driver/orders/[id]/photo/route");
    const { GET: viewPhoto } = await import("@/app/api/orders/[id]/photo/route");
    process.env.STORAGE_DIR = `${process.cwd()}/storage-files-test`;
    const { driver, customer, newOrder, goOnline } = await setup();
    const order = await newOrder();
    await goOnline();
    await call(accept, { token: driver.token, params: { id: order.id } });

    expect((await upload(photo, driver.token, order.id, jpeg())).status).toBe(409); // not picked up yet
    await advanceOrder(order.id);
    await advanceOrder(order.id);
    await call(pickup, { token: driver.token, params: { id: order.id } });

    const bad = await upload(photo, driver.token, order.id, new File(["hi"], "x.txt", { type: "text/plain" }));
    expect(bad.status).toBe(400);
    expect((await upload(photo, driver.token, order.id, jpeg())).status).toBe(201);

    const seen = await (viewPhoto as (r: Request, c: unknown) => Promise<Response>)(
      new Request("http://test.local/api", { headers: { authorization: `Bearer ${customer.token}` } }),
      { params: Promise.resolve({ id: String(order.id) }) },
    );
    expect(seen.status).toBe(200);
    expect(seen.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await seen.arrayBuffer()).slice(0, 2)).toEqual(new Uint8Array([0xff, 0xd8]));

    const stranger = await makeUser();
    const blocked = await call(viewPhoto, { method: "GET", token: stranger.token, params: { id: order.id } });
    expect(blocked.status).toBe(404);
    expect((await call(customerOrder, { method: "GET", token: customer.token, params: { id: order.id } })).body.has_photo).toBe(true);
  });
});
