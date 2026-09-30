import { ApiError } from "./http";

// Fixed-window limiter kept in memory. Fine for one server; with several
// servers in production this should move to a shared store (e.g. Redis).
const hits = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt <= now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  entry.count++;
  if (entry.count > limit) {
    throw new ApiError(429, "Too many attempts. Please wait a few minutes and try again.");
  }
}

export function clientIp(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export function resetRateLimits() {
  hits.clear();
}
