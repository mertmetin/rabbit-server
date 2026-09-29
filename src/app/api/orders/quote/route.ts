import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { readJson, route } from "@/lib/http";
import { basketSchema, deliveryContext, MIN_ORDER_CENTS, priceBasket } from "@/lib/orders";

// Totals for the checkout screen, priced by the server.
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const body = await readJson(req, basketSchema);

  const { address } = await deliveryContext(db, user.id, body.store_id, body.address_id);
  const priced = await priceBasket(db, body.store_id, body.items, address.provinceCode);

  return Response.json({
    subtotal: priced.subtotal / 100,
    tax: priced.tax / 100,
    delivery_fee: 0,
    total: priced.total / 100,
    min_order: MIN_ORDER_CENTS / 100,
    meets_minimum: priced.subtotal >= MIN_ORDER_CENTS,
  });
});
