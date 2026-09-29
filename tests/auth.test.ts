import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as register } from "@/app/api/users/route";
import { PATCH as activate } from "@/app/api/users/[id]/activate/route";
import { POST as resend } from "@/app/api/users/[id]/token/resend/route";
import { POST as login } from "@/app/api/login/route";
import { GET as me } from "@/app/api/user/route";
import { POST as recover } from "@/app/api/users/password/recovery/route";
import { PATCH as resetPassword } from "@/app/api/users/[id]/password/reset/route";
import { PATCH as changePassword } from "@/app/api/users/[id]/password/change/route";
import { PUT as editUser, DELETE as deleteUser } from "@/app/api/users/[id]/route";
import { sentSms } from "./setup";
import { call, lastCode } from "./helpers";

const alice = { name: "Alice", phone: "(613) 555-0101", email: "Alice@Example.com", password: "correct horse" };
const bob = { name: "Bob", phone: "613-555-0202", email: "bob@example.com", password: "battery staple" };

// Codes are rate-limited to one per 30 seconds; pretend earlier ones are old.
const ageCodes = () =>
  db.verificationCode.updateMany({ data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });

async function signUpAndActivate(person: typeof alice) {
  const { body } = await call(register, { body: person });
  await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: lastCode() } });
  const res = await call(login, { body: { phone: person.phone, password: person.password } });
  return { id: body.id as number, token: res.body.token as string };
}

describe("sign up and activation", () => {
  it("creates an inactive account and texts a code without returning it", async () => {
    const res = await call(register, { body: alice });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), phone: "6135550101" });
    expect(JSON.stringify(res.body)).not.toContain(lastCode());
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0].phone).toBe("6135550101");

    const user = await db.user.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(user.email).toBe("alice@example.com");
    expect(user.passwordHash).not.toContain(alice.password);
    expect(user.phoneVerifiedAt).toBeNull();
  });

  it("rejects a second account with the same phone", async () => {
    await call(register, { body: alice });
    const res = await call(register, { body: { ...bob, phone: "6135550101" } });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already registered/);
  });

  it("rejects short passwords and bad phone numbers", async () => {
    expect((await call(register, { body: { ...alice, password: "1234" } })).status).toBe(422);
    expect((await call(register, { body: { ...alice, phone: "555-0101" } })).status).toBe(422);
  });

  it("won't log in until the account is activated", async () => {
    const { body } = await call(register, { body: alice });
    const res = await call(login, { body: { phone: alice.phone, password: alice.password } });
    expect(res.status).toBe(403);
    expect(res.body.user_id).toBe(body.id);
  });

  it("activates with the right code and then logs in", async () => {
    const { body } = await call(register, { body: alice });

    const wrong = await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: "99999" } });
    expect(wrong.status).toBe(400);

    const ok = await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: lastCode() } });
    expect(ok.status).toBe(200);

    const res = await call(login, { body: { phone: "6135550101", password: alice.password } });
    expect(res.status).toBe(200);
    expect(decodeJwt(res.body.token)).toMatchObject({
      id: body.id, name: "Alice", email: "alice@example.com", phone: "6135550101",
    });
  });

  it("locks a code after 5 wrong tries", async () => {
    const { body } = await call(register, { body: alice });
    const code = lastCode();
    const wrongCode = code === "0000" ? "1111" : "0000";
    for (let i = 0; i < 5; i++) {
      await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: wrongCode } });
    }
    const res = await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: code } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/);
  });

  it("resends a code, replacing the old one, but not too often", async () => {
    const { body } = await call(register, { body: alice });
    const first = lastCode();

    const tooSoon = await call(resend, { params: { id: body.id }, body: { phone: alice.phone } });
    expect(tooSoon.status).toBe(429);

    await ageCodes();
    const res = await call(resend, { params: { id: body.id }, body: { phone: alice.phone } });
    expect(res.status).toBe(200);
    expect(sentSms).toHaveLength(2);

    if (first !== lastCode()) {
      const old = await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: first } });
      expect(old.status).toBe(400);
    }
    const ok = await call(activate, { method: "PATCH", params: { id: body.id }, body: { token: lastCode() } });
    expect(ok.status).toBe(200);
  });

  it("won't resend to a phone that doesn't match the account", async () => {
    const { body } = await call(register, { body: alice });
    await ageCodes();
    const res = await call(resend, { params: { id: body.id }, body: { phone: bob.phone } });
    expect(res.status).toBe(404);
  });
});

describe("login", () => {
  it("gives the same answer for an unknown phone and a wrong password", async () => {
    await signUpAndActivate(alice);
    const wrongPassword = await call(login, { body: { phone: alice.phone, password: "nope" } });
    const unknownPhone = await call(login, { body: { phone: "6135559999", password: "nope" } });
    expect(wrongPassword.status).toBe(401);
    expect(unknownPhone).toEqual(wrongPassword);
  });

  it("returns the signed-in user only with a valid token", async () => {
    const { id, token } = await signUpAndActivate(alice);
    expect((await call(me, { method: "GET" })).status).toBe(401);
    expect((await call(me, { method: "GET", token: token + "x" })).status).toBe(401);

    const res = await call(me, { method: "GET", token });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: "Alice", active: true });
    expect(res.body).not.toHaveProperty("passwordHash");
  });
});

describe("password reset by SMS", () => {
  it("texts a code, never returns it, and sets the new password", async () => {
    const { id } = await signUpAndActivate(alice);
    await ageCodes();

    const res = await call(recover, { body: { phone: alice.phone } });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ user_id: id, phone: "6135550101" });
    const code = lastCode();

    const reset = await call(resetPassword, {
      method: "PATCH", params: { id }, body: { token: code, password: "new password!" },
    });
    expect(reset.status).toBe(200);

    expect((await call(login, { body: { phone: alice.phone, password: alice.password } })).status).toBe(401);
    expect((await call(login, { body: { phone: alice.phone, password: "new password!" } })).status).toBe(200);

    const reuse = await call(resetPassword, {
      method: "PATCH", params: { id }, body: { token: code, password: "another one" },
    });
    expect(reuse.status).toBe(400);
  });

  it("an activation code can't be used to reset a password", async () => {
    const { body } = await call(register, { body: alice });
    const res = await call(resetPassword, {
      method: "PATCH", params: { id: body.id }, body: { token: lastCode(), password: "new password!" },
    });
    expect(res.status).toBe(400);
  });
});

describe("account changes", () => {
  it("changes password only with the current one", async () => {
    const { id, token } = await signUpAndActivate(alice);
    const wrong = await call(changePassword, {
      method: "PATCH", token, params: { id }, body: { oldPassword: "nope", password: "new password!" },
    });
    expect(wrong.status).toBe(400);

    const ok = await call(changePassword, {
      method: "PATCH", token, params: { id }, body: { oldPassword: alice.password, password: "new password!" },
    });
    expect(ok.status).toBe(200);
    expect((await call(login, { body: { phone: alice.phone, password: "new password!" } })).status).toBe(200);
  });

  it("edits the signed-in user's own details", async () => {
    const { id, token } = await signUpAndActivate(alice);
    const res = await call(editUser, { method: "PUT", token, params: { id }, body: { name: "Alice B" } });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Alice B");
  });

  it("stops one customer from touching another's account", async () => {
    const a = await signUpAndActivate(alice);
    const b = await signUpAndActivate(bob);

    const edit = await call(editUser, { method: "PUT", token: a.token, params: { id: b.id }, body: { name: "Hacked" } });
    const change = await call(changePassword, {
      method: "PATCH", token: a.token, params: { id: b.id }, body: { oldPassword: alice.password, password: "hijacked!!" },
    });
    const del = await call(deleteUser, { method: "DELETE", token: a.token, params: { id: b.id } });

    expect([edit.status, change.status, del.status]).toEqual([403, 403, 403]);
    expect((await db.user.findUniqueOrThrow({ where: { id: b.id } })).name).toBe("Bob");
  });

  it("deletes the account", async () => {
    const { id, token } = await signUpAndActivate(alice);
    expect((await call(deleteUser, { method: "DELETE", token, params: { id } })).status).toBe(204);
    expect(await db.user.findUnique({ where: { id } })).toBeNull();
    expect((await call(me, { method: "GET", token })).status).toBe(401);
  });
});
