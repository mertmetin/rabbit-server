import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { DELIVERY_FEE_CENTS, FREE_DELIVERY_OVER_CENTS, MIN_ORDER_CENTS } from "@/lib/delivery";
import { basketSchema, deliveryContext, priceBasket } from "@/lib/orders";

// Totals for the checkout screen, priced by the server.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req, basketSchema);

  const { address } = await deliveryContext(db, user.id, body.store_id, body.address_id);
  const priced = await priceBasket(db, user.id, body.store_id, body.items, address.provinceCode);

  return Response.json({
    subtotal: priced.subtotal / 100,
    tax: priced.tax / 100,
    delivery_fee: priced.delivery.cents / 100,
    // Why delivery costs what it does: first_order, over_threshold or standard.
    delivery_reason: priced.delivery.reason,
    standard_delivery_fee: DELIVERY_FEE_CENTS / 100,
    free_delivery_over: FREE_DELIVERY_OVER_CENTS / 100,
    total: priced.total / 100,
    min_order: MIN_ORDER_CENTS / 100,
    meets_minimum: priced.subtotal >= MIN_ORDER_CENTS,
  });
});
