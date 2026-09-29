import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { stripe } from "@/lib/stripe";

// The signed-in user's saved cards, straight from Stripe (we never store card data).
export const GET = route(async (req) => {
  const user = await requireUser(req);
  if (!user.stripeCustomerId) return Response.json([]);

  const methods = await stripe().customers.listPaymentMethods(user.stripeCustomerId, { type: "card", limit: 20 });
  return Response.json(
    methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand,
      last4: pm.card?.last4,
      exp_month: pm.card?.exp_month,
      exp_year: pm.card?.exp_year,
    })),
  );
});
