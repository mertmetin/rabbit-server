import type { Product, UserAddress } from "@/generated/prisma/client";

// JSON shapes the app reads. Field names stay snake_case to match the app.

export function productJson(product: Product, quantity?: number) {
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    price: product.priceCents / 100,
    price_cents: product.priceCents,
    image: product.image,
    taxable: product.taxable,
    category_id: product.categoryId,
    ...(quantity === undefined ? {} : { quantity }),
  };
}

export function addressJson(address: UserAddress) {
  return {
    id: address.id,
    user_id: address.userId,
    // The app reads both `address_type.type` and `icon` for the type.
    address_type: { type: address.type },
    icon: address.type,
    label: address.label,
    address_line_1: address.addressLine1,
    address_line_2: address.addressLine2,
    city: address.city,
    zone_code: address.provinceCode,
    postal_code: address.postalCode,
    country_code: address.countryCode,
    latitude: Number(address.latitude),
    longitude: Number(address.longitude),
    notes: address.notes,
  };
}

// Images stored as "/images/..." are served by this app; make them absolute
// using the host the client connected to, so phones on the LAN can load them.
export function absoluteUrl(path: string | null, req: Request) {
  if (!path || /^https?:\/\//.test(path)) return path;
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return new URL(path, `${proto}://${host}`).toString();
}
