import { publicUser, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isFirstOrder } from "@/lib/delivery";
import { route } from "@/lib/http";

// The signed-in customer. `first_order` lets the basket say the first
// delivery is free instead of counting up to the free-delivery threshold.
export const GET = route(async (req) => {
  const user = await requireUser(req);
  return Response.json({ ...publicUser(user), first_order: await isFirstOrder(db, user.id) });
});
