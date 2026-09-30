import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { GET as chatIdentity } from "@/app/api/support/chat-identity/route";
import { call } from "./helpers";
import { makeUser } from "./factories";

describe("support chat identity", () => {
  afterEach(() => {
    delete process.env.CHATWOOT_HMAC_TOKEN;
  });

  it("gives the customer a stable, unguessable identifier with their details", async () => {
    const { user, token } = await makeUser();
    const first = await call(chatIdentity, { method: "GET", token });
    const again = await call(chatIdentity, { method: "GET", token });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ name: user.name, email: user.email, custom_attributes: { account_id: user.id, phone: user.phone } });
    expect(first.body.identifier).toMatch(new RegExp(`^rabbit-${user.id}-[0-9a-f]{16}$`));
    expect(again.body.identifier).toBe(first.body.identifier);
    expect(first.body.identifier_hash).toBe("");
  });

  it("signs the identifier when identity validation is set up", async () => {
    process.env.CHATWOOT_HMAC_TOKEN = "inbox-secret";
    const { token } = await makeUser();
    const { body } = await call(chatIdentity, { method: "GET", token });
    expect(body.identifier_hash).toBe(createHmac("sha256", "inbox-secret").update(body.identifier).digest("hex"));
  });

  it("requires sign-in", async () => {
    expect((await call(chatIdentity, { method: "GET" })).status).toBe(401);
  });
});
