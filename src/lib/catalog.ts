import { db } from "./db";
import { notFound } from "./http";

export async function activeStore(storeId: number) {
  const store = await db.store.findFirst({ where: { id: storeId, active: true } });
  if (!store) throw notFound("This store isn't available.");
  return store;
}

export function storeJson(store: { id: number; name: string; latitude: unknown; longitude: unknown; deliveryRadiusKm: unknown }) {
  return {
    id: store.id,
    name: store.name,
    latitude: Number(store.latitude),
    longitude: Number(store.longitude),
    delivery_radius_km: Number(store.deliveryRadiusKm),
  };
}

// Everything the store has on its shelves, with the product and its category.
export function inStock(storeId: number) {
  return db.inventory.findMany({
    where: { storeId, quantity: { gt: 0 } },
    include: { product: { include: { category: true } } },
  });
}

// One entry per variant group (the first of its variants in the list), with
// variant_count saying how many of the group's variants the list holds.
// Products outside a group pass through unchanged.
export function oneTilePerGroup<T extends { group_id: number | null }>(items: T[]) {
  const counts = new Map<number, number>();
  for (const item of items) if (item.group_id !== null) counts.set(item.group_id, (counts.get(item.group_id) ?? 0) + 1);
  const seen = new Set<number>();
  return items.flatMap((item) => {
    if (item.group_id === null) return [item];
    if (seen.has(item.group_id)) return [];
    seen.add(item.group_id);
    return [{ ...item, variant_count: counts.get(item.group_id)! }];
  });
}
