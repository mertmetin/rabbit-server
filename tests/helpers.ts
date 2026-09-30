import { sentSms } from "./setup";

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

// Calls a route handler the way Next.js would and returns status + JSON body.
export async function call(
  handler: unknown,
  opts: { method?: string; body?: unknown; token?: string; params?: Record<string, string | number> } = {},
) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const req = new Request("http://test.local/api", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const params = Object.fromEntries(Object.entries(opts.params ?? {}).map(([k, v]) => [k, String(v)]));
  const res = await (handler as Handler)(req, { params: Promise.resolve(params) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

export function lastCode(): string {
  const sms = sentSms.at(-1);
  if (!sms) throw new Error("No SMS was sent.");
  return sms.text.match(/code is (\d+)/)![1];
}
