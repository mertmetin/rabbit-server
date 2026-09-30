import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { currentAdmin } from "@/lib/admin-session";
import { photoResponse } from "@/lib/photo";

// Same photo for the admin dashboard (signed in by cookie, not bearer token).
export async function GET(_req: Request, ctx: RouteContext<"/admin/orders/[id]/photo">) {
  if (!(await currentAdmin())) return new Response("Unauthorized", { status: 401 });
  const order = await db.order.findUnique({ where: { id: Number((await ctx.params).id) } });
  if (!order) notFound();
  return photoResponse(order).catch(() => new Response("Not found", { status: 404 }));
}
