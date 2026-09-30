import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as check } from "@/app/api/auth/check/route";
import { POST as start } from "@/app/api/auth/start/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as complete } from "@/app/api/auth/complete/route";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as me } from "@/app/api/user/route";
import { PUT as editUser, DELETE as deleteUser } from "@/app/api/users/[id]/route";
import { PUT as changePassword } from "@/app/api/users/[id]/password/route";
import { sentSms } from "./setup";
import { call, lastCode } from "./helpers";

const PHONE = "(613) 555-0101";
const PASSWORD = "correct horse";

// Codes are rate-limited to one per 30 seconds; pretend earlier ones are old.
const ageCodes = () =>
  db.verificationCode.updateMany({ data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });

async function signUp(phone = PHONE, name = "Alice", email = "alice@example.com") {
  await call(start, { body: { phone, purpose: "signup" } });
  const { body } = await call(verify, { body: { phone, code: lastCode() } });
  const res = await call(complete, { body: { setup_token: body.setup_token, name, email, password: PASSWORD } });
  return res.body as { token: string; user: { id: number; name: string } };
}

describe("sign up (phone verified by SMS)", () => {
  it("new numbers get a 6-digit code, never returned by the API", async () => {
    expect((await call(check, { body: { phone: PHONE } })).body).toEqual({ phone: "6135550101", exists: false });
    const res = await call(start, { body: { phone: PHONE, purpose: "signup" } });
    expect(res).toEqual({ status: 200, body: { phone: "6135550101" } });
    expect(sentSms[0].phone).toBe("6135550101");
    expect(lastCode()).toMatch(/^\d{6}$/);
  });

  it("verifying the code gives a setup token, not a session", async () => {
    await call(start, { body: { phone: PHONE, purpose: "signup" } });
    const { body } = await call(verify, { body: { phone: PHONE, code: lastCode() } });
    expect(body.is_new).toBe(true);
    expect((await call(me, { method: "GET", token: body.setup_token })).status).toBe(401);
  });

  it("creates the account with name, email and password, and signs in", async () => {
    const { token, user } = await signUp();
    expect(user).toMatchObject({ name: "Alice", email: "alice@example.com", active: true });
    expect(decodeJwt(token)).toMatchObject({ id: user.id, name: "Alice" });
    expect((await call(me, { method: "GET", token })).status).toBe(200);
    expect((await call(check, { body: { phone: PHONE } })).body.exists).toBe(true);
  });

  it("requires name and email for a new account, and an 8+ character password", async () => {
    await call(start, { body: { phone: PHONE, purpose: "signup" } });
    const { body } = await call(verify, { body: { phone: PHONE, code: lastCode() } });
    expect((await call(complete, { body: { setup_token: body.setup_token, password: PASSWORD } })).status).toBe(422);
    expect((await call(complete, { body: { setup_token: body.setup_token, name: "A", email: "a@example.com", password: "short" } })).status).toBe(422);
  });

  it("won't sign up a number that already has an account", async () => {
    await signUp();
    await ageCodes();
    const res = await call(start, { body: { phone: PHONE, purpose: "signup" } });
    expect(res.status).toBe(409);
  });

  it("rejects an email another account uses", async () => {
    await signUp("6135550101", "A", "shared@example.com");
    const res = await signUpRaw("6135550202", "shared@example.com");
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/email/);
  });

  it("an unverified number can't sign in", async () => {
    await call(start, { body: { phone: PHONE, purpose: "signup" } });
    expect((await call(check, { body: { phone: PHONE } })).body.exists).toBe(false);
    expect((await call(login, { body: { phone: PHONE, password: PASSWORD } })).status).toBe(401);
  });
});

async function signUpRaw(phone: string, email: string) {
  await call(start, { body: { phone, purpose: "signup" } });
  const { body } = await call(verify, { body: { phone, code: lastCode() } });
  return call(complete, { body: { setup_token: body.setup_token, name: "B", email, password: PASSWORD } });
}

describe("sign in with password", () => {
  it("signs in with phone and password, no SMS needed", async () => {
    const { user } = await signUp();
    const smsBefore = sentSms.length;
    const res = await call(login, { body: { phone: "613-555-0101", password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user.id);
    expect(sentSms.length).toBe(smsBefore);
  });

  it("rejects a wrong password, and slows down guessing", async () => {
    await signUp();
    expect((await call(login, { body: { phone: PHONE, password: "nope" } })).status).toBe(401);
    for (let i = 0; i < 9; i++) await call(login, { body: { phone: PHONE, password: "nope" } });
    const res = await call(login, { body: { phone: PHONE, password: PASSWORD } });
    expect(res.status).toBe(429);
  });
});

describe("forgot password (SMS code)", () => {
  it("resets the password after verifying the phone", async () => {
    const { user } = await signUp();
    await ageCodes();
    expect((await call(start, { body: { phone: PHONE, purpose: "reset" } })).status).toBe(200);
    const { body } = await call(verify, { body: { phone: PHONE, code: lastCode() } });
    expect(body.is_new).toBe(false);

    const res = await call(complete, { body: { setup_token: body.setup_token, password: "brand new pass" } });
    expect(res.body.user).toMatchObject({ id: user.id, name: "Alice" });
    expect((await call(login, { body: { phone: PHONE, password: PASSWORD } })).status).toBe(401);
    expect((await call(login, { body: { phone: PHONE, password: "brand new pass" } })).status).toBe(200);
  });

  it("won't send a reset code to a number without an account", async () => {
    expect((await call(start, { body: { phone: PHONE, purpose: "reset" } })).status).toBe(404);
  });

  it("locks a code after 5 wrong tries, and a code works only once", async () => {
    await call(start, { body: { phone: PHONE, purpose: "signup" } });
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) await call(verify, { body: { phone: PHONE, code: wrong } });
    expect((await call(verify, { body: { phone: PHONE, code } })).status).toBe(400);

    await ageCodes();
    await call(start, { body: { phone: PHONE, purpose: "signup" } });
    const fresh = lastCode();
    expect((await call(verify, { body: { phone: PHONE, code: fresh } })).status).toBe(200);
    expect((await call(verify, { body: { phone: PHONE, code: fresh } })).status).toBe(400);
  });

  it("limits how many numbers one device can text", async () => {
    for (let i = 0; i < 10; i++) {
      await call(start, { body: { phone: `61355502${String(i).padStart(2, "0")}`, purpose: "signup" } });
    }
    expect((await call(start, { body: { phone: "6135550299", purpose: "signup" } })).status).toBe(429);
    expect(sentSms).toHaveLength(10);
  });
});

describe("account changes", () => {
  it("changes the password with the current one", async () => {
    const { token, user } = await signUp();
    const wrong = await call(changePassword, { method: "PUT", token, params: { id: user.id }, body: { current_password: "nope", password: "new password!" } });
    expect(wrong.status).toBe(400);
    const ok = await call(changePassword, { method: "PUT", token, params: { id: user.id }, body: { current_password: PASSWORD, password: "new password!" } });
    expect(ok.status).toBe(200);
    expect((await call(login, { body: { phone: PHONE, password: "new password!" } })).status).toBe(200);
  });

  it("edits name and email and returns a fresh token", async () => {
    const { token, user } = await signUp();
    const res = await call(editUser, { method: "PUT", token, params: { id: user.id }, body: { name: "Alice B" } });
    expect(decodeJwt(res.body.token)).toMatchObject({ name: "Alice B" });
  });

  it("stops one customer from touching another's account", async () => {
    const a = await signUp("6135550101", "A", "a@example.com");
    const b = await signUp("6135550202", "B", "b@example.com");
    const edit = await call(editUser, { method: "PUT", token: a.token, params: { id: b.user.id }, body: { name: "Hacked" } });
    const pw = await call(changePassword, { method: "PUT", token: a.token, params: { id: b.user.id }, body: { current_password: PASSWORD, password: "hijacked!!" } });
    const del = await call(deleteUser, { method: "DELETE", token: a.token, params: { id: b.user.id } });
    expect([edit.status, pw.status, del.status]).toEqual([403, 403, 403]);
  });

  it("deletes the account, after which the token stops working", async () => {
    const { token, user } = await signUp();
    expect((await call(deleteUser, { method: "DELETE", token, params: { id: user.id } })).status).toBe(204);
    expect((await call(me, { method: "GET", token })).status).toBe(401);
  });

  it("anonymises a deleted customer with orders but keeps the orders", async () => {
    const { token, user } = await signUp();
    const store = await db.store.create({ data: { name: "S", latitude: 45.42, longitude: -75.69 } });
    await db.order.create({
      data: { userId: user.id, storeId: store.id, status: "delivered", deliveryAddress: {}, subtotalCents: 2500, taxCents: 0, totalCents: 2500 },
    });
    expect((await call(deleteUser, { method: "DELETE", token, params: { id: user.id } })).status).toBe(204);
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ name: "Deleted customer", email: null, phone: `deleted-${user.id}`, passwordHash: null });
    expect(await db.order.count({ where: { userId: user.id } })).toBe(1);
    // The number is free to sign up again.
    expect((await signUp()).user.id).not.toBe(user.id);
  });
});
