// Starter data for local development: two Ottawa stores, a grocery catalogue
// (shared basics plus a few store-only items) with per-store stock,
// promotions, and two sign-in accounts.
// Re-running replaces the catalogue (until orders exist); accounts are kept.
import "dotenv/config";
import { readFileSync } from "node:fs";
import bcrypt from "bcryptjs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../src/generated/prisma/client";

if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed a production database.");

const db = new PrismaClient({ adapter: new PrismaMariaDb(process.env.DATABASE_URL!) });

// Product photos from Unsplash (free to use under the Unsplash License).
const photo = (id: string) => `https://images.unsplash.com/photo-${id}?w=600&h=600&fit=crop&auto=format&q=80`;

// [title, description, price in cents, Unsplash photo id, options]
// Options: taxable (HST applies; basic groceries are zero-rated), and
// only: a store name for items that store alone carries.
type Options = { taxable?: boolean; only?: "Ottawa Centre" | "Ottawa East" };
type ProductRow = readonly [string, string, number, string, Options?];
// A family of variants shown as one tile with option chips; its first
// variant is the one the tile shows.
type Variant = { title: string; priceCents: number; image: string; options: Record<string, string> };
type VariantGroup = { title: string; variants: Variant[] };
type Aisle = { title: string; products?: readonly ProductRow[]; groups?: VariantGroup[] };
type Category = Aisle & { children?: Aisle[] };

// Aisles kept as CSV (prisma/data/*.csv) so they can be edited in a
// spreadsheet. Columns: subcategory, group, title, price, options, image.
// Rows sharing a group become one tile; options reads "Flavour: Vanilla |
// Size: 650 g". A blank image uses the subcategory's placeholder photo.
function csvAisles(file: string, placeholders: Record<string, string>): Aisle[] {
  const [, ...rows] = parseCsv(readFileSync(new URL(`./data/${file}`, import.meta.url), "utf8"));
  const aisles = new Map<string, { products: ProductRow[]; groups: Map<string, VariantGroup> }>();
  for (const [subcategory, group, title, price, options, image] of rows) {
    const aisle = aisles.get(subcategory) ?? { products: [], groups: new Map<string, VariantGroup>() };
    aisles.set(subcategory, aisle);
    const priceCents = Math.round(Number(price) * 100);
    const photoId = image || placeholders[subcategory];
    if (!group) {
      aisle.products.push([title, "", priceCents, photoId]);
      continue;
    }
    const variants = aisle.groups.get(group)?.variants ?? [];
    aisle.groups.set(group, { title: group, variants });
    const pairs = options.split("|").map((pair) => pair.split(":").map((part) => part.trim()));
    variants.push({ title, priceCents, image: photo(photoId), options: Object.fromEntries(pairs) });
  }
  return [...aisles].map(([title, { products, groups }]) => ({ title, products, groups: [...groups.values()] }));
}

// Amounts (milk fat, sizes, pack counts) smallest first: "Skim", "1%", "2%";
// "1 L", "2 L", "4 L"; "4 x 100 g", "650 g". Anything else (flavours) keeps
// the order it was written in.
function inOrder(values: string[]) {
  const unit: Record<string, number> = { "": 1, "%": 1, g: 1, ml: 1, kg: 1000, l: 1000 };
  const amount = (value: string) => {
    if (value === "Skim") return 0;
    const m = value.match(/^(?:(\d+)\s*x\s*)?(\d+(?:\.\d+)?)\s*(%|g|kg|ml|l)?$/i);
    return m ? Number(m[1] ?? 1) * Number(m[2]) * unit[(m[3] ?? "").toLowerCase()] : NaN;
  };
  return values.every((value) => !Number.isNaN(amount(value))) ? [...values].sort((a, b) => amount(a) - amount(b)) : values;
}

// Enough CSV for these files: commas, and quoted fields with "" escapes.
function parseCsv(text: string) {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    const fields = [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)];
    rows.push(fields.map((m) => (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2])));
  }
  return rows;
}

const catalog: Category[] = [
  { title: "Drinks", products: [
    ["Spring water, 24 x 500 ml", "Natural spring water.", 499, "1740905328339-03ce7edcdc28"], // Grafix Naim
    ["Whole bean coffee, 340 g", "Medium roast whole beans.", 1399, "1587049016823-69ef9d68bd44"], // Mockup Graphics
  ] },
  { title: "Fruit & Vegetables", children: [
    { title: "Fruit", products: [
      ["Gala apples, 3 lb bag", "Crisp, sweet Ontario Gala apples.", 599, "1568579029378-d2cc4074f57c"], // Richard Pennystan
      ["Bananas, bunch", "About 6 ripe bananas.", 179, "1587132137056-bfbf0166836e"], // Mockup Graphics
      ["Mandarin oranges, 2 lb", "Easy-peel, seedless mandarins.", 449, "1587735243615-c03f25aaff15"], // Mockup Graphics
      ["Strawberries, 1 lb", "Sweet, juicy strawberries.", 499, "1749587452499-ea1fd591e63f"], // Lorin Both
      ["Blueberries, pint", "Plump blueberries.", 399, "1584879135892-53935a4b1408"], // Sonya Eliseeva
    ] },
    { title: "Vegetables", products: [
      ["Carrots, 2 lb bag", "Crunchy carrots for snacking or roasting.", 249, "1763712505260-def761cd0c34"], // Jenny Johannessen
      ["Broccoli crown", "Fresh green broccoli.", 299, "1615485290382-441e4d049cb5"], // Mockup Graphics
      ["Tomatoes on the vine", "About 1.5 lb of vine-ripened tomatoes.", 399, "1630177134330-43383b181740"], // Maddie Leopardo
      ["Avocados, 4 pack", "Hass avocados, ripen on the counter.", 599, "1718829732697-740b87cf509b"], // John Cameron
    ] },
  ] },
  { title: "Dairy & Eggs", children: csvAisles("dairy-eggs.csv", {
    Milk: "1523473827533-2a64d0d36748", // Mehrshad Rajabi
    Yogurt: "1763825613390-287a9db0803d", // Nikita Khowala
  }) },
  { title: "Snacks", products: [
    ["Dark chocolate with almonds, 100 g", "70% dark chocolate with whole almonds.", 349, "1720029106261-0d0396bb270d", { taxable: true }], // D. Stoyanova
    ["Oatmeal cookies, 12 pack", "Chewy oatmeal cookies, baked in Ottawa.", 499, "1554886729-fe8d4499a108", { only: "Ottawa East" }], // Hayley Maxwell
  ] },
  { title: "Breakfast", products: [
    ["Maple granola, 500 g", "Oat clusters with Canadian maple.", 649, "1622542086073-dcdc3350cc2b"], // ABHISHEK HAJARE
  ] },
  { title: "Bakery", products: [
    ["Baguette", "Classic French baguette, baked daily.", 349, "1608100742430-b8c4b9bf1276"], // KWON JUNHO
    ["Sourdough loaf", "Naturally leavened country sourdough.", 649, "1677825948767-5d379d012bda"], // Caramel
    ["Butter croissants, 4 pack", "Flaky all-butter croissants.", 699, "1691480162735-9b91238080f6", { only: "Ottawa Centre" }], // personalgraphic.com
  ] },
  { title: "Ice Cream", products: [
    ["Vanilla ice cream, 1.5 L", "Creamy French vanilla.", 699, "1689076758310-92b693fe6b8b"], // BINYOUSSIF mohammad ali
  ] },
  { title: "Pantry Staples", products: [
    ["Spaghetti, 900 g", "Durum wheat spaghetti.", 299, "1518675219903-c682c4b16b1d"], // Deva Darshan
    ["Basmati rice, 2 kg", "Long-grain aged basmati.", 899, "1723879683042-8e72c359ec2e"], // Aditya Sethia
  ] },
  { title: "Ready Meals", products: [
    ["Frozen fries, 1 kg", "Straight-cut fries, oven or air fryer.", 399, "1615485290836-4ebcebf44aaf"], // Mockup Graphics
  ] },
  { title: "Meat, Poultry & Fish", products: [
    ["Chicken breasts, about 1 kg", "Boneless, skinless Canadian chicken.", 1599, "1708782342351-74f02e9a16c4"], // Rimsha Noor
    ["Atlantic salmon fillets, 2 pack", "Fresh skin-on salmon fillets.", 1399, "1614627293113-e7e68163d958", { only: "Ottawa Centre" }], // Melanie Andersen
  ] },
  { title: "Healthy Living", products: [
    ["Raw almonds, 400 g", "Unsalted whole almonds.", 849, "1602948750761-97ea79ee42ec"], // The DK Photography
  ] },
  { title: "Personal Care", products: [
    ["Toothpaste, 120 ml", "Fluoride toothpaste, fresh mint.", 349, "1610216690558-4aee861f4ab3", { taxable: true }], // Jonathan Cooper
    ["Moisturizing shampoo, 400 ml", "For dry and damaged hair.", 899, "1747858989102-cca0f4dc4a11", { taxable: true }], // Ela De Pure
  ] },
  { title: "Pets", products: [
    ["Adult dog food, 4 kg", "Chicken and rice dry dog food.", 2499, "1497993950456-cdb57afd1cf1", { taxable: true }], // Ken Reid
    ["Cat food, 12 cans", "Assorted wet cat food.", 1399, "1596854331442-3cf47265cefb", { taxable: true }], // Kabo
  ] },
  { title: "Household", products: [
    ["Dish soap, 740 ml", "Grease-cutting dish soap.", 399, "1649005011845-ef225c89da86", { taxable: true }], // Sufyan
    ["Toilet paper, 12 rolls", "Soft 2-ply toilet paper.", 1099, "1584743579083-b331c4adbb15", { taxable: true }], // Christine Sandu
  ] },
  { title: "Home & Living", products: [
    ["Pillar candle", "Unscented white pillar candle.", 1299, "1485364103940-e8aff191ed1e", { taxable: true, only: "Ottawa East" }], // Janko Ferlič
    ["LED light bulbs, 4 pack", "60 W equivalent, soft white.", 999, "1532007271951-c487760934ae", { taxable: true }], // Federico Bottos
  ] },
  { title: "Baby", products: [
    ["Baby bottle, 260 ml", "BPA-free anti-colic bottle.", 1199, "1676843546660-f502dfcea3f7", { taxable: true }], // Suzanne Skeen
  ] },
];

async function main() {
  // Orders keep references to products, so only rebuild the catalogue before any exist.
  if ((await db.orderItem.count()) > 0) {
    console.log("Orders exist; leaving the catalogue as it is.");
    return;
  }
  await db.$transaction([
    db.inventory.deleteMany(),
    db.product.deleteMany(),
    db.productGroup.deleteMany(),
    db.productCategory.deleteMany({ where: { parentId: { not: null } } }),
    db.productCategory.deleteMany(),
    db.promotion.deleteMany(),
    db.city.deleteMany(),
  ]);

  const stores = await Promise.all([
    upsertStore("Ottawa Centre", 45.4215, -75.6972),
    upsertStore("Ottawa East", 45.4558, -75.5047),
  ]);

  const [centre, east] = stores;
  const storeByName = { "Ottawa Centre": centre, "Ottawa East": east };
  const stock: { storeId: number; productId: number; quantity: number }[] = [];
  let count = 0;

  const addProducts = async (categoryId: number, rows: readonly ProductRow[]) => {
    for (const [title, description, priceCents, photoId, options = {}] of rows) {
      const product = await db.product.create({
        data: { title, description, priceCents, image: photo(photoId), taxable: options.taxable ?? false, categoryId },
      });
      const carriers = options.only ? [storeByName[options.only]] : stores;
      for (const store of carriers) stock.push({ storeId: store.id, productId: product.id, quantity: 10 + ((count * 7) % 30) });
      count++;
    }
  };

  const addGroup = async (categoryId: number, group: VariantGroup) => {
    // Each option's values in the order the variants first use them.
    const options = new Map<string, string[]>();
    for (const variant of group.variants)
      for (const [name, value] of Object.entries(variant.options)) {
        const values = options.get(name) ?? [];
        if (!values.includes(value)) values.push(value);
        options.set(name, values);
      }
    const { id: groupId } = await db.productGroup.create({
      data: { title: group.title, options: [...options].map(([name, values]) => ({ name, values: inOrder(values) })) },
    });
    for (const { title, priceCents, image, options } of group.variants) {
      const product = await db.product.create({
        data: { title, description: "", priceCents, image, categoryId, groupId, options },
      });
      for (const store of stores) stock.push({ storeId: store.id, productId: product.id, quantity: 10 + ((count * 7) % 30) });
      count++;
    }
  };

  const addAisle = async (categoryId: number, aisle: Aisle) => {
    for (const group of aisle.groups ?? []) await addGroup(categoryId, group);
    if (aisle.products) await addProducts(categoryId, aisle.products);
  };
  for (const [i, top] of catalog.entries()) {
    const parent = await db.productCategory.create({ data: { title: top.title, sortOrder: i } });
    await addAisle(parent.id, top);
    for (const [j, child] of (top.children ?? []).entries()) {
      const sub = await db.productCategory.create({ data: { title: child.title, parentId: parent.id, sortOrder: j } });
      await addAisle(sub.id, child);
    }
    // A category's tile shows its first product's photo.
    const first = await db.product.findFirstOrThrow({
      where: { OR: [{ categoryId: parent.id }, { category: { parentId: parent.id } }] },
      orderBy: { id: "asc" },
    });
    await db.productCategory.update({ where: { id: parent.id }, data: { image: first.image } });
  }

  // One basic sold out at Ottawa East, to show out-of-stock items disappearing.
  const blueberries = await db.product.findFirstOrThrow({ where: { title: { startsWith: "Blueberries" } } });
  for (const row of stock) if (row.storeId === east.id && row.productId === blueberries.id) row.quantity = 0;
  await db.inventory.createMany({ data: stock });

  await db.promotion.createMany({
    data: [
      { title: "Free delivery on your first order", description: "Your first Rabbit order is delivered free anywhere in Ottawa.", image: photo("1588964895597-cfccd6e2dbf9") }, // Maria Lin Kim
      { title: "Fresh from local farms", description: "Seasonal Ontario produce, picked this week.", image: photo("1485637701894-09ad422f6de6") }, // Anne Preble
    ],
  });
  await db.city.create({ data: { name: "Ottawa" } });

  const demo = await upsertUser("Demo Customer", "6135550100", "demo@rabbit.test", "rabbit-demo", "customer");
  const admin = await upsertUser("Rabbit Admin", "6135550199", "admin@rabbit.test", "rabbit-admin", "admin");

  console.log(`Seeded ${stores.length} stores, ${catalog.length} categories, ${count} products.`);
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
