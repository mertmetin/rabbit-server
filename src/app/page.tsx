import { db } from "@/lib/db";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

// Landing page for the backend. In development: what's in the database and
// where the API lives. In production it's public, so just the name.
export default async function Home() {
  if (process.env.NODE_ENV === "production") {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={44} height={44} className={styles.logo} />
          Rabbit
        </h1>
        <p className={styles.muted}>Grocery delivery in Ottawa.</p>
      </main>
    );
  }

  const [stores, products, customers, orders] = await Promise.all([
    db.store.count({ where: { active: true } }),
    db.product.count(),
    db.user.count({ where: { role: "customer" } }),
    db.order.count(),
  ]);
  const firstStore = await db.store.findFirst({ where: { active: true }, orderBy: { id: "asc" } });

  const links = [
    "/api/stores",
    "/api/stores/closest?lat=45.4236&lng=-75.7009",
    firstStore && `/api/stores/${firstStore.id}/categories`,
    firstStore && `/api/search?store_id=${firstStore.id}&q=apple`,
    "/api/promotions",
  ].filter(Boolean) as string[];

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={44} height={44} className={styles.logo} />
        Rabbit
      </h1>
      <p className={styles.muted}>Grocery delivery API. <a href="/admin">Open the admin dashboard →</a></p>

      <div className={styles.stats}>
        <div className={styles.stat}><strong>{stores}</strong>stores</div>
        <div className={styles.stat}><strong>{products}</strong>products</div>
        <div className={styles.stat}><strong>{customers}</strong>customers</div>
        <div className={styles.stat}><strong>{orders}</strong>orders</div>
      </div>

      <h2>Try the API</h2>
      <ul className={styles.endpoints}>
        {links.map((href) => (
          <li key={href}><a href={href}>{href}</a></li>
        ))}
      </ul>
    </main>
  );
}
