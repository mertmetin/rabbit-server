import { describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { signLinkToken } from "@/lib/auth";
import { badRequest } from "@/lib/http";
import { POST as google } from "@/app/api/auth/google/route";
import { POST as start } from "@/app/api/auth/start/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { DELETE as deleteUser } from "@/app/api/users/[id]/route";
import { call, lastCode } from "./helpers";

// Google's token check is replaced by a table of fake ID tokens.
const PROFILES: Record<string, { sub: string; email: string | null; name: string }> = {
  "token-alice": { sub: "google-alice", email: "alice@gmail.com", name: "Alice Martin" },
  "token-unverified": { sub: "google-bob", email: null, name: "Bob" },
};
vi.mock("@/lib/google", () => ({
  verifyGoogleIdToken: async (idToken: string) => {
    const profile = PROFILES[idToken];
    if (!profile) throw badRequest("Couldn't sign in with Google. Please try again.");
    return profile;
  },
}));

const PHONE = "6135550111";

async function linkWithPhone(idToken: string, phone = PHONE) {
  const first = await call(google, { body: { id_token: idToken } });
  await call(start, { body: { phone } });
  return call(verify, { body: { phone, code: lastCode(), link_token: first.body.link_token } });
}

describe("Continue with Google", () => {
  it("a new Google account confirms a phone number first, then is linked", async () => {
    const res = await call(google, { body: { id_token: "token-alice" } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ needs_phone: true, name: "Alice Martin", email: "alice@gmail.com" });
    expect(res.body.token).toBeUndefined();

    const linked = await linkWithPhone("token-alice");
    expect(linked.body.user).toMatchObject({ name: "Alice Martin", email: "alice@gmail.com", needs_profile: false });
    expect((await db.user.findUnique({ where: { phone: PHONE } }))?.googleSub).toBe("google-alice");
  });

  it("once linked, Google signs straight in with no SMS", async () => {
    const linked = await linkWithPhone("token-alice");
    const res = await call(google, { body: { id_token: "token-alice" } });
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user.id).toBe(linked.body.user.id);
  });

  it("keeps the name and email a customer already has, and skips unverified emails", async () => {
    await call(start, { body: { phone: PHONE } });
    await call(verify, { body: { phone: PHONE, code: lastCode() } });
    await db.user.update({ where: { phone: PHONE }, data: { name: "Ali", email: "ali@example.com", verificationCodes: { deleteMany: {} } } });

    await linkWithPhone("token-alice");
    expect(await db.user.findUnique({ where: { phone: PHONE } })).toMatchObject({ name: "Ali", email: "ali@example.com", googleSub: "google-alice" });

    const bob = await linkWithPhone("token-unverified", "6135550112");
    expect(bob.body.user).toMatchObject({ name: "Bob", email: null, needs_profile: true });
  });

  it("a Google account can't be linked to a second phone number", async () => {
    // Two sign-ins in flight at once: both got a link token before either finished.
    const raceToken = await signLinkToken(PROFILES["token-alice"]);
    await linkWithPhone("token-alice");
    await call(start, { body: { phone: "6135550113" } });
    const second = await call(verify, { body: { phone: "6135550113", code: lastCode(), link_token: raceToken } });
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/already linked/);
  });

  it("rejects bad Google tokens and forged link tokens", async () => {
    expect((await call(google, { body: { id_token: "nonsense" } })).status).toBe(400);

    await call(start, { body: { phone: PHONE } });
    const res = await call(verify, { body: { phone: PHONE, code: lastCode(), link_token: "forged" } });
    expect(res.status).toBe(400);
    expect((await db.user.findUnique({ where: { phone: PHONE } }))?.googleSub).toBeNull();
  });

  it("deleting the account unlinks Google", async () => {
    const linked = await linkWithPhone("token-alice");
    await call(deleteUser, { method: "DELETE", token: linked.body.token, params: { id: linked.body.user.id } });
    expect(await db.user.findFirst({ where: { googleSub: "google-alice" } })).toBeNull();
    expect((await call(google, { body: { id_token: "token-alice" } })).body.needs_phone).toBe(true);
  });
});
