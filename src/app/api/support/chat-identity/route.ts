import { createHmac } from "node:crypto";
import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";

const hmac = (key: string, message: string) => createHmac("sha256", key).update(message).digest("hex");

// Who the signed-in customer is in the Chatwoot support chat. The identifier
// is derived from JWT_SECRET so it can't be guessed from an account id (the
// widget's website token is public). With CHATWOOT_HMAC_TOKEN (the inbox's
// "Identity validation" secret) set, Chatwoot also checks identifier_hash,
// so nobody can open a chat as someone else.
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const identifier = `rabbit-${user.id}-${hmac(process.env.JWT_SECRET!, `chat:${user.id}`).slice(0, 16)}`;
  const secret = process.env.CHATWOOT_HMAC_TOKEN;

  return Response.json({
    identifier,
    identifier_hash: secret ? hmac(secret, identifier) : "",
    name: user.name,
    email: user.email ?? "",
    custom_attributes: { account_id: user.id, phone: user.phone },
  });
});
