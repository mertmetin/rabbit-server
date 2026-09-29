import Link from "next/link";
import { db } from "@/lib/db";
import { StockForm } from "./StockForm";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: PageProps<"/admin/stock">) {
  const { store: storeParam } = await searchParams;
  const stores = await db.store.findMany({ where: { active: true }, orderBy: { id: "asc" } });
  const store = stores.find((s) => String(s.id) === storeParam) ?? stores[0];
  if (!store) return <p>No stores yet.</p>;

  const products = await db.product.findMany({
    include: { category: { include: { parent: true } }, inventory: { where: { storeId: store.id } } },
    orderBy: { title: "asc" },
  });

  const rows = products.map((p) => ({
    id: p.id,
    title: p.title,
    image: p.image,
    category: p.category.parent?.title ?? p.category.title,
    quantity: p.inventory[0]?.quantity ?? null,
  }));

  return (
    <>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Stock</h1>
      </div>
      <div className={styles.tabs}>
        {stores.map((s) => (
          <Link key={s.id} href={`/admin/stock?store=${s.id}`} className={`${styles.tab} ${s.id === store.id ? styles.tabActive : ""}`}>{s.name}</Link>
        ))}
      </div>
      <p className={styles.muted}>
        Set how many of each product {store.name} has. 0 hides it from customers until you restock;
        leave a box empty for products this store doesn&apos;t carry.
      </p>
      <section className={styles.card}>
        <StockForm key={store.id} storeId={store.id} rows={rows} />
      </section>
    </>
  );
}
