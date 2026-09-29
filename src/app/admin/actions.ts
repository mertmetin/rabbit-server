"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { checkPassword, signToken } from "@/lib/auth";
import { normalizePhone } from "@/lib/phone";
import { ApiError } from "@/lib/http";
import { ADMIN_COOKIE, requireAdmin } from "@/lib/admin-session";
import { advanceOrder, cancelOrderAsAdmin, saveProduct, setStock } from "@/lib/admin";

// Every action checks the admin session itself: server actions can be
// called directly, not just from these pages.

export type FormState = { error?: string; ok?: string } | undefined;

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : err instanceof z.ZodError ? err.issues[0].message : "Something went wrong.";

export async function login(_state: FormState, form: FormData): Promise<FormState> {
  const phone = normalizePhone(String(form.get("phone") ?? ""));
  const password = String(form.get("password") ?? "");
  const user = phone ? await db.user.findUnique({ where: { phone } }) : null;

  if (!user || !(await checkPassword(password, user.passwordHash)) || user.role !== "admin" || !user.phoneVerifiedAt) {
    return { error: "Wrong phone number or password, or not an admin account." };
  }

  (await cookies()).set(ADMIN_COOKIE, await signToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/admin",
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect("/admin");
}

export async function logout() {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: "/admin" });
  redirect("/admin/login");
}

export async function advanceOrderAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("orderId"));
  await advanceOrder(id).catch(() => {});
  revalidatePath("/admin", "layout");
}

export async function cancelOrderAction(form: FormData) {
  await requireAdmin();
  const id = Number(form.get("orderId"));
  await cancelOrderAsAdmin(id).catch(() => {});
  revalidatePath("/admin", "layout");
}

export async function saveProductAction(_state: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const id = form.get("id") ? Number(form.get("id")) : null;
  let saved;
  try {
    saved = await saveProduct(id, {
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      price: String(form.get("price") ?? ""),
      categoryId: String(form.get("categoryId") ?? ""),
      image: String(form.get("image") ?? ""),
      taxable: form.get("taxable") === "on",
    });
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/admin", "layout");
  if (!id) redirect(`/admin/products/${saved.id}?created=1`);
  return { ok: "Saved." };
}

export async function saveStockAction(_state: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const storeId = Number(form.get("storeId"));
  const quantities: Record<number, number> = {};
  for (const [key, value] of form.entries()) {
    if (!key.startsWith("qty_") || value === "") continue;
    const quantity = Number(value);
    if (!Number.isFinite(quantity) || quantity < 0) return { error: "Stock must be 0 or more." };
    quantities[Number(key.slice(4))] = quantity;
  }
  try {
    await setStock(storeId, quantities);
  } catch (err) {
    return { error: message(err) };
  }
  revalidatePath("/admin", "layout");
  return { ok: "Stock saved." };
}
