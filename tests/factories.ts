import { db } from "@/lib/db";
import { signToken, hashPassword } from "@/lib/auth";

let seq = 0;

export async function makeUser(overrides: { role?: "customer" | "admin" } = {}) {
  seq++;
  const user = await db.user.create({
    data: {
      name: `User ${seq}`,
      phone: `613555${String(seq).padStart(4, "0")}`,
      email: `user${seq}@example.com`,
      passwordHash: await hashPassword("password123"),
      phoneVerifiedAt: new Date(),
      role: overrides.role ?? "customer",
    },
  });
  return { user, token: await signToken(user) };
}

// Two Ottawa stores with a small catalogue:
// Produce > Fruit (Apples, Bananas), Produce > Vegetables (Carrots), Bakery (Baguette, out of stock at Centre).
export async function makeCatalog() {
  const centre = await db.store.create({ data: { name: "Ottawa Centre", latitude: 45.4215, longitude: -75.6972 } });
  const east = await db.store.create({ data: { name: "Ottawa East", latitude: 45.4558, longitude: -75.5047 } });

  const produce = await db.productCategory.create({ data: { title: "Produce", sortOrder: 1 } });
  const fruit = await db.productCategory.create({ data: { title: "Fruit", parentId: produce.id } });
  const veg = await db.productCategory.create({ data: { title: "Vegetables", parentId: produce.id } });
  const bakery = await db.productCategory.create({ data: { title: "Bakery", sortOrder: 2 } });

  const product = (title: string, categoryId: number, priceCents: number, taxable = false) =>
    db.product.create({ data: { title, description: `Fresh ${title.toLowerCase()}`, priceCents, categoryId, image: `https://img.test/${title}.jpg`, taxable } });

  const apples = await product("Apples", fruit.id, 399);
  const bananas = await product("Bananas", fruit.id, 149);
  const carrots = await product("Carrots", veg.id, 229);
  const baguette = await product("Baguette", bakery.id, 350);

  await db.inventory.createMany({
    data: [
      { storeId: centre.id, productId: apples.id, quantity: 20 },
      { storeId: centre.id, productId: bananas.id, quantity: 0 },
      { storeId: centre.id, productId: carrots.id, quantity: 5 },
      { storeId: centre.id, productId: baguette.id, quantity: 0 },
      { storeId: east.id, productId: baguette.id, quantity: 8 },
    ],
  });

  return { centre, east, produce, fruit, veg, bakery, apples, bananas, carrots, baguette };
}
