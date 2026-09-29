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
