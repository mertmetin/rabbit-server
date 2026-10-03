import { route } from "@/lib/http";
import { TYPICAL_PRODUCTS } from "@/lib/eta";
import { pointSchema, servingBranch } from "@/lib/stores";

// The branch serving this point, its status and delivery time (see
// servingBranch). /api/stores/stream pushes the same thing live.
export const GET = route(async (req) => {
  const { lat, lng, products } = pointSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  return Response.json(await servingBranch(lat, lng, products || TYPICAL_PRODUCTS));
});
