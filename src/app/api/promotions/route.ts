import { db } from "@/lib/db";
import { route } from "@/lib/http";

export const GET = route(async () => {
  const promotions = await db.promotion.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(
    promotions.map((p) => ({ id: p.id, title: p.title, description: p.description, image: p.image })),
  );
});
