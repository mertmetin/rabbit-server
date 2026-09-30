import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as start } from "@/app/api/auth/start/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { GET as me } from "@/app/api/user/route";
import { PUT as editUser, DELETE as deleteUser } from "@/app/api/users/[id]/route";
import { sentSms } from "./setup";
import { call, lastCode } from "./helpers";

const PHONE = "(613) 555-0101";

// Codes are rate-limited to one per 30 seconds; pretend earlier ones are old.
const ageCodes = () =>
  db.verificationCode.updateMany({ data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });

async function signIn(phone = PHONE) {
  await call(start, { body: { phone } });
  const res = await call(verify, { body: { phone, code: lastCode() } });
  return res.body as { token: string; user: { id: number; needs_profile: boolean } };
}

describe("sign in with an SMS code", () => {
  it("texts a 6-digit code to a new number and never returns it", async () => {
    const res = await call(start, { body: { phone: PHONE } });
    expect(res).toEqual({ status: 200, body: { phone: "6135550101", is_new: true } });
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].phone).toBe("6135550101");
    expect(lastCode()).toMatch(/^\d{6}$/);
    expect(JSON.stringify(res.body)).not.toContain(lastCode());
  });

  it("signs in with the right code; new accounts need a name and email", async () => {
    const { token, user } = await signIn();
    expect(user.needs_profile).toBe(true);
    expect(decodeJwt(token)).toMatchObject({ id: user.id, phone: "6135550101" });
    expect((await call(me, { method: "GET", token })).body).toMatchObject({ id: user.id, active: true });
  });

  it("completing the profile returns a fresh token with the name in it", async () => {
    const { token, user } = await signIn();
    const res = await call(editUser, {
      method: "PUT", token, params: { id: user.id }, body: { name: "Alice", email: "Alice@Example.com" },
    });
    expect(res.body).toMatchObject({ name: "Alice", email: "alice@example.com", needs_profile: false });
    expect(decodeJwt(res.body.token)).toMatchObject({ name: "Alice" });
  });

  it("returning customers are recognised and skip the profile step", async () => {
    const first = await signIn();
    await call(editUser, { method: "PUT", token: first.token, params: { id: first.user.id }, body: { name: "Alice", email: "a@example.com" } });
    await ageCodes();

    const res = await call(start, { body: { phone: "613-555-0101" } });
    expect(res.body.is_new).toBe(false);
    const again = await call(verify, { body: { phone: PHONE, code: lastCode() } });
    expect(again.body.user).toMatchObject({ id: first.user.id, needs_profile: false });
  });

  it("rejects a wrong code and locks the code after 5 tries", async () => {
    await call(start, { body: { phone: PHONE } });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    const first = await call(verify, { body: { phone: PHONE, code: wrong } });
    expect(first.status).toBe(400);
    for (let i = 0; i < 4; i++) await call(verify, { body: { phone: PHONE, code: wrong } });

    const res = await call(verify, { body: { phone: PHONE, code } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/);
  });

  it("a code works once, and only the newest code works", async () => {
    await call(start, { body: { phone: PHONE } });
    const oldCode = lastCode();
    expect((await call(start, { body: { phone: PHONE } })).status).toBe(429); // too soon

    await ageCodes();
    await call(start, { body: { phone: PHONE } });
    const newCode = lastCode();
    if (oldCode !== newCode) expect((await call(verify, { body: { phone: PHONE, code: oldCode } })).status).toBe(400);
    expect((await call(verify, { body: { phone: PHONE, code: newCode } })).status).toBe(200);
    expect((await call(verify, { body: { phone: PHONE, code: newCode } })).status).toBe(400);
  });

  it("limits how many numbers one device can text", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await call(start, { body: { phone: `61355502${String(i).padStart(2, "0")}` } })).status).toBe(200);
    }
    const res = await call(start, { body: { phone: "6135550299" } });
    expect(res.status).toBe(429);
    expect(sentSms).toHaveLength(10);
  });

  it("rejects bad phone numbers and malformed codes", async () => {
    expect((await call(start, { body: { phone: "555-0101" } })).status).toBe(422);
    expect((await call(verify, { body: { phone: PHONE, code: "12ab" } })).status).toBe(422);
  });

  it("an unverified number can't use the API", async () => {
    await call(start, { body: { phone: PHONE } });
    const user = await db.user.findUniqueOrThrow({ where: { phone: "6135550101" } });
    expect(user.phoneVerifiedAt).toBeNull();
  });
});

describe("account changes", () => {
  it("rejects an email another account uses", async () => {
    const a = await signIn("6135550101");
    await call(editUser, { method: "PUT", token: a.token, params: { id: a.user.id }, body: { name: "A", email: "shared@example.com" } });
    const b = await signIn("6135550202");
    const res = await call(editUser, { method: "PUT", token: b.token, params: { id: b.user.id }, body: { name: "B", email: "shared@example.com" } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/email/);
  });

  it("stops one customer from touching another's account", async () => {
    const a = await signIn("6135550101");
    const b = await signIn("6135550202");
    const edit = await call(editUser, { method: "PUT", token: a.token, params: { id: b.user.id }, body: { name: "Hacked" } });
    const del = await call(deleteUser, { method: "DELETE", token: a.token, params: { id: b.user.id } });
    expect([edit.status, del.status]).toEqual([403, 403]);
  });

  it("deletes the account, after which the token stops working", async () => {
    const { token, user } = await signIn();
    expect((await call(deleteUser, { method: "DELETE", token, params: { id: user.id } })).status).toBe(204);
    expect(await db.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect((await call(me, { method: "GET", token })).status).toBe(401);
  });
});

describe("deleting an account with order history", () => {
  it("anonymises the customer but keeps their orders", async () => {
    const { token, user } = await signIn();
    const store = await db.store.create({ data: { name: "S", latitude: 45.42, longitude: -75.69 } });
    await db.order.create({
      data: { userId: user.id, storeId: store.id, status: "delivered", deliveryAddress: {}, subtotalCents: 2500, taxCents: 0, totalCents: 2500 },
    });

    expect((await call(deleteUser, { method: "DELETE", token, params: { id: user.id } })).status).toBe(204);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ name: "Deleted customer", email: null, phone: `deleted-${user.id}`, phoneVerifiedAt: null });
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    expect((await call(me, { method: "GET", token })).status).toBe(401);

    // The number can sign up again as a fresh account.
    const fresh = await signIn();
    expect(fresh.user.id).not.toBe(user.id);
  });
});
