import { requireUser } from "@/lib/auth";
import { route } from "@/lib/http";
import { stripe, stripeCustomerId } from "@/lib/stripe";

// Starts adding a card: the app shows Stripe's card form with these secrets,
// and the card is saved to the user's Stripe customer.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const customer = await stripeCustomerId(user);

  const intent = await stripe().setupIntents.create({
    customer,
    usage: "off_session",
    payment_method_types: ["card"],
  });
  const ephemeralKey = await stripe().ephemeralKeys.create({ customer }, { apiVersion: "2020-08-27" });

  return Response.json({ client_secret: intent.client_secret, customer_id: customer, ephemeral_key: ephemeralKey.secret });
});
