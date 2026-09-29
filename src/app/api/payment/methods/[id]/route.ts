import { requireUser } from "@/lib/auth";
import { notFound, route } from "@/lib/http";
import { stripe } from "@/lib/stripe";

// Removes a saved card, after checking it belongs to this user.
export const DELETE = route(async (req, ctx: RouteContext<"/api/payment/methods/[id]">) => {
  const user = await requireUser(req);
  const { id } = await ctx.params;
  const method = user.stripeCustomerId ? await stripe().paymentMethods.retrieve(id).catch(() => null) : null;
  if (!method || method.customer !== user.stripeCustomerId) throw notFound("Card not found.");

  await stripe().paymentMethods.detach(id);
  return new Response(null, { status: 204 });
});
