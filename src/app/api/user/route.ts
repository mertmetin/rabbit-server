import { publicUser, requireUser } from "@/lib/auth";
import { route } from "@/lib/http";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return Response.json(publicUser(user));
});
