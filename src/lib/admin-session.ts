import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { User } from "@/generated/prisma/client";
import { userFromToken } from "./auth";

export const ADMIN_COOKIE = "rabbit_admin";

// The signed-in admin for this browser, or null.
export async function currentAdmin(): Promise<User | null> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!token) return null;
  const user = await userFromToken(token);
  return user?.role === "admin" ? user : null;
}

// For admin pages and actions: sends anyone else to the sign-in page.
export async function requireAdmin(): Promise<User> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}
