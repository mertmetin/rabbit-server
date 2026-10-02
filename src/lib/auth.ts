import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { User } from "@/generated/prisma/client";
import type { GoogleProfile } from "./google";
import { db } from "./db";
import { forbidden, unauthorized } from "./http";

const TOKEN_TTL = "30d";

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw new Error("JWT_SECRET is not set.");
  return new TextEncoder().encode(value);
}

export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const checkPassword = (password: string, hash: string | null) => (hash ? bcrypt.compare(password, hash) : Promise.resolve(false));

// The app decodes these claims to show the account screen.
export function signToken(user: User) {
  return new SignJWT({ id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(secret());
}

// A Google account waiting to be linked while the customer confirms their
// phone by SMS. Short-lived, and only accepted by /api/auth/verify.
export function signLinkToken(google: GoogleProfile) {
  return new SignJWT({ purpose: "google-link", email: google.email, name: google.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(google.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(secret());
}

export async function readLinkToken(token: string): Promise<GoogleProfile | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== "google-link" || !payload.sub) return null;
    return { sub: payload.sub, email: (payload.email as string | null) ?? null, name: String(payload.name ?? "") };
  } catch {
    return null;
  }
}

// The active user a token belongs to, or null if it's invalid or expired.
export async function userFromToken(token: string): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const user = await db.user.findUnique({ where: { id: Number(payload.sub) } });
    return user && user.phoneVerifiedAt ? user : null;
  } catch {
    return null;
  }
}

export async function requireUser(req: Request): Promise<User> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw unauthorized();

  const user = await userFromToken(token);
  if (!user) throw unauthorized("Your session has expired. Please sign in again.");
  return user;
}

// A customer may only act on their own account; admins on any.
export function assertSelf(user: User, userId: number) {
  if (user.id !== userId && user.role !== "admin") throw forbidden();
}

export async function requireAdmin(req: Request): Promise<User> {
  const user = await requireUser(req);
  if (user.role !== "admin") throw forbidden();
  return user;
}

export function publicUser(user: User) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    active: user.phoneVerifiedAt !== null,
    needs_profile: !user.name || !user.email,
    created_at: user.createdAt,
  };
}
