import { db } from "@/lib/db";
import { route } from "@/lib/http";
import { absoluteUrl } from "@/lib/serialize";

export const GET = route(async (req) => {
  const promotions = await db.promotion.findMany({ orderBy: { createdAt: "desc" } });
  return Response.json(
    promotions.map((p) => ({ id: p.id, title: p.title, description: p.description, image: absoluteUrl(p.image, req) })),
  );
});
