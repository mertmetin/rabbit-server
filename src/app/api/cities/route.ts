import { db } from "@/lib/db";
import { route } from "@/lib/http";

export const GET = route(async () => {
  const cities = await db.city.findMany({ orderBy: { name: "asc" } });
  return Response.json(cities);
});
