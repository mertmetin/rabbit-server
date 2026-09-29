import { NextResponse, type NextRequest } from "next/server";

// CORS for the API, so the app's web build (e.g. localhost:8081) can call it.
// Auth uses bearer tokens, not cookies, so credentials are never allowed.
// CORS_ORIGINS is a comma-separated list; in development any origin is allowed.
const allowed = (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);

const corsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "600",
};

function allowOrigin(origin: string) {
  return origin !== "" && (process.env.NODE_ENV === "development" || allowed.includes(origin));
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin") ?? "";
  const headers: Record<string, string> = { ...corsHeaders, Vary: "Origin" };
  if (allowOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
