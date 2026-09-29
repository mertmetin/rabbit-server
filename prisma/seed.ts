// Starter data for local development: two Ottawa stores, a small grocery
// catalogue with stock, promotions, and two sign-in accounts.
// Re-running replaces the catalogue (until orders exist); accounts are kept.
import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

// Product photos from Unsplash (free to use under the Unsplash License).
const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=600&h=600&fit=crop&auto=format&q=80`;

const catalog = [
  {
    title: "Produce", icon: "vegetables-box-48.png", children: [
      { title: "Fruit", products: [
        ["Gala apples, 3 lb bag", "Crisp, sweet Ontario Gala apples.", 599, "1568579029378-d2cc4074f57c"], // Richard Pennystan
        ["Bananas, bunch", "About 6 ripe bananas.", 179, "1587132137056-bfbf0166836e"], // Mockup Graphics
        ["Strawberries, 1 lb", "Sweet, juicy strawberries.", 499, "1749587452499-ea1fd591e63f"], // Lorin Both
        ["Blueberries, pint", "Plump wild-style blueberries.", 399, "1584879135892-53935a4b1408"], // Sonya Eliseeva
      ] },
      { title: "Vegetables", products: [
        ["Carrots, 2 lb bag", "Crunchy carrots for snacking or roasting.", 249, "1763712505260-def761cd0c34"], // Jenny Johannessen
        ["Broccoli crown", "Fresh green broccoli.", 299, "1615485290382-441e4d049cb5"], // Mockup Graphics
        ["Tomatoes on the vine", "About 1.5 lb of vine-ripened tomatoes.", 399, "1630177134330-43383b181740"], // Maddie Leopardo
        ["Avocados, 4 pack", "Hass avocados, ripen on the counter.", 599, "1718829732697-740b87cf509b"], // John Cameron
      ] },
    ],
  },
  {
    title: "Bakery", icon: "baguette-48.png", products: [
      ["Baguette", "Classic French baguette, baked daily.", 349, "1608100742430-b8c4b9bf1276"], // KWON JUNHO
      ["Sourdough loaf", "Naturally leavened country sourdough.", 649, "1677825948767-5d379d012bda"], // Caramel
      ["Butter croissants, 4 pack", "Flaky all-butter croissants.", 699, "1691480162735-9b91238080f6"], // personalgraphic.com
    ],
  },
  {
    title: "Dairy & Eggs", icon: "cheese-48.png", products: [
      ["2% milk, 2 L", "Fresh Canadian 2% milk.", 479, "1523473827533-2a64d0d36748"], // Mehrshad Rajabi
      ["Large brown eggs, dozen", "Grade A large brown eggs.", 499, "1760745271267-c8ec89f0b6d1"], // Evvlus
      ["Aged cheddar, 400 g", "Sharp two-year aged cheddar.", 799, "1700760933494-8a322667a3f4"], // Farhad Ibrahimzade
      ["Greek yogurt, 750 g", "Plain 2% Greek yogurt.", 549, "1763825613390-287a9db0803d"], // Nikita Khowala
    ],
  },
  {
    title: "Pantry", icon: "ingredients-48.png", products: [
      ["Spaghetti, 900 g", "Durum wheat spaghetti.", 299, "1518675219903-c682c4b16b1d"], // Deva Darshan
      ["Whole bean coffee, 340 g", "Medium roast whole beans.", 1399, "1587049016823-69ef9d68bd44"], // Mockup Graphics
    ],
  },
  {
    title: "Frozen", icon: "fish-and-vegetables-48.png", products: [
      ["Frozen fries, 1 kg", "Straight-cut fries, oven or air fryer.", 399, "1615485290836-4ebcebf44aaf"], // Mockup Graphics
    ],
  },
  {
    title: "Snacks", icon: "taco-48.png", products: [
      // Confectionery is taxable in Canada; the groceries above are zero-rated.
      ["Dark chocolate with almonds, 100 g", "70% dark chocolate with whole almonds.", 349, "1720029106261-0d0396bb270d", true], // D. Stoyanova
    ],
  },
] as const;

type ProductRow = readonly [string, string, number, string, boolean?];

async function main() {
  // Orders keep references to products, so only rebuild the catalogue before any exist.
  if ((await db.orderItem.count()) > 0) {
    console.log("Orders exist; leaving the catalogue as it is.");
    return;
  }
  await db.$transaction([
    db.inventory.deleteMany(),
    db.product.deleteMany(),
    db.productCategory.deleteMany({ where: { parentId: { not: null } } }),
    db.productCategory.deleteMany(),
    db.promotion.deleteMany(),
    db.city.deleteMany(),
  ]);

  const stores = await Promise.all([
    upsertStore("Ottawa Centre", 45.4215, -75.6972),
    upsertStore("Ottawa East", 45.4558, -75.5047),
  ]);

  const productIds: number[] = [];
  const addProducts = async (categoryId: number, rows: readonly ProductRow[]) => {
    for (const [title, description, priceCents, photoId, taxable] of rows) {
      const product = await db.product.create({
        data: { title, description, priceCents, image: photo(photoId), taxable: taxable ?? false, categoryId },
      });
      productIds.push(product.id);
    }
  };

  for (const [i, top] of catalog.entries()) {
    const parent = await db.productCategory.create({
      data: { title: top.title, image: `/images/categories/${top.icon}`, sortOrder: i },
    });
    if ("products" in top) await addProducts(parent.id, top.products);
    if ("children" in top) {
      for (const [j, child] of top.children.entries()) {
        const sub = await db.productCategory.create({ data: { title: child.title, parentId: parent.id, sortOrder: j } });
        await addProducts(sub.id, child.products);
      }
    }
  }

  // Everything in stock at Centre; East is missing a few items.
  await db.inventory.createMany({
    data: stores.flatMap((store, s) =>
      productIds.map((productId, p) => ({ storeId: store.id, productId, quantity: s === 1 && p % 5 === 0 ? 0 : 10 + ((p * 7) % 30) })),
    ),
  });

  await db.promotion.createMany({
    data: [
      { title: "Free delivery on your first order", description: "Your first Rabbit order is delivered free anywhere in Ottawa.", image: photo("1588964895597-cfccd6e2dbf9") }, // Maria Lin Kim
      { title: "Fresh from local farms", description: "Seasonal Ontario produce, picked this week.", image: photo("1485637701894-09ad422f6de6") }, // Anne Preble
    ],
  });
  await db.city.create({ data: { name: "Ottawa" } });

  const demo = await upsertUser("Demo Customer", "6135550100", "demo@rabbit.test", "rabbit-demo", "customer");
  const admin = await upsertUser("Rabbit Admin", "6135550199", "admin@rabbit.test", "rabbit-admin", "admin");

  console.log(`Seeded ${stores.length} stores, ${productIds.length} products.`);
  console.log(`Sign in as customer: ${demo.phone} / rabbit-demo`);
  console.log(`Sign in as admin:    ${admin.phone} / rabbit-admin`);
}

async function upsertStore(name: string, latitude: number, longitude: number) {
  const existing = await db.store.findFirst({ where: { name } });
  return existing
    ? db.store.update({ where: { id: existing.id }, data: { latitude, longitude, active: true } })
    : db.store.create({ data: { name, latitude, longitude } });
}

async function upsertUser(name: string, phone: string, email: string, password: string, role: "customer" | "admin") {
  return db.user.upsert({
    where: { phone },
    update: {},
    create: { name, phone, email, role, passwordHash: await bcrypt.hash(password, 12), phoneVerifiedAt: new Date() },
  });
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
