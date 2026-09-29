import { describe, expect, it } from "vitest";
import { GET as list, POST as create } from "@/app/api/users/[id]/addresses/route";
import { PUT as update, DELETE as remove } from "@/app/api/users/[id]/addresses/[addressId]/route";
import { call } from "./helpers";
import { makeUser } from "./factories";

const home = {
  icon: "home",
  label: "Home",
  address_line_1: "110 Laurier Ave W",
  city: "Ottawa",
  zone_code: "on",
  postal_code: "k1p 1j1",
  country_code: "CA",
  latitude: 45.4208,
  longitude: -75.6975,
  notes: "Buzz 12",
};

describe("user addresses", () => {
  it("saves an address in the shape the app sends and lists it back", async () => {
    const { user, token } = await makeUser();
    const res = await call(create, { token, params: { id: user.id }, body: { address: home } });
    expect(res.status).toBe(201);

    const { body } = await call(list, { method: "GET", token, params: { id: user.id } });
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      address_type: { type: "home" }, icon: "home", zone_code: "ON", postal_code: "K1P 1J1", latitude: 45.4208, notes: "Buzz 12",
    });
  });

  it("requires the fields a delivery needs", async () => {
    const { user, token } = await makeUser();
    const { latitude: _lat, city: _city, ...partial } = home;
    const res = await call(create, { token, params: { id: user.id }, body: { address: partial } });
    expect(res.status).toBe(422);
  });

  it("updates and deletes the user's own address", async () => {
    const { user, token } = await makeUser();
    const { body: created } = await call(create, { token, params: { id: user.id }, body: home });

    const updated = await call(update, {
      method: "PUT", token, params: { id: user.id, addressId: created.id }, body: { ...home, address_type: "work", label: "Office" },
    });
    expect(updated.body).toMatchObject({ address_type: { type: "work" }, label: "Office" });

    const del = await call(remove, { method: "DELETE", token, params: { id: user.id, addressId: created.id } });
    expect(del.status).toBe(204);
    expect((await call(list, { method: "GET", token, params: { id: user.id } })).body).toEqual([]);
  });

  it("keeps each customer's addresses private", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { body: bAddress } = await call(create, { token: b.token, params: { id: b.user.id }, body: home });

    expect((await call(list, { method: "GET", token: a.token, params: { id: b.user.id } })).status).toBe(403);
    expect((await call(create, { token: a.token, params: { id: b.user.id }, body: home })).status).toBe(403);
    // Using your own user id with someone else's address id finds nothing.
    const del = await call(remove, { method: "DELETE", token: a.token, params: { id: a.user.id, addressId: bAddress.id } });
    expect(del.status).toBe(404);
  });
});
