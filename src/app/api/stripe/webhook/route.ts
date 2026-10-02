import Stripe from "stripe";
import { db } from "@/lib/db";
import { cancelOrder, markPaid } from "@/lib/orders";

// Stripe calls this when a payment's state changes, so an order is placed
// even if the customer's app closed right after paying. Every request is
// checked against STRIPE_WEBHOOK_SECRET; handling is idempotent because
// Stripe may deliver an event more than once.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 500 });

  const signature = req.headers.get("stripe-signature") ?? "";
  const payload = await req.text(); // the exact bytes Stripe signed
  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type.startsWith("payment_intent.")) {
    const intent = event.data.object as Stripe.PaymentIntent;
    const order = await db.order.findUnique({ where: { stripePaymentIntentId: intent.id }, include: { items: true } });

    if (order && order.status === "pending_payment") {
      // amount_capturable_updated: the card is authorized (charged after shopping).
      if (event.type === "payment_intent.amount_capturable_updated" || event.type === "payment_intent.succeeded") {
        await markPaid(order.id);
      } else if (event.type === "payment_intent.payment_failed" || event.type === "payment_intent.canceled") {
        await cancelOrder(order); // releases the reserved stock
      }
    }
  }

  return Response.json({ received: true });
}
