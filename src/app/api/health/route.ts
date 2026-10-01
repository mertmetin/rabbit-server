// For the load balancer's health check (App Runner). Doesn't touch the
// database, so a slow database doesn't get healthy servers replaced.
export function GET() {
  return Response.json({ ok: true });
}
