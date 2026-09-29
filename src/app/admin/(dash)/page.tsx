import Link from "next/link";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES, STATUS_LABEL, dashboardStats } from "@/lib/admin";
import { AutoRefresh } from "../AutoRefresh";
import { money, when } from "../format";
import styles from "../admin.module.css";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [stats, active] = await Promise.all([
    dashboardStats(),
    db.order.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      include: { items: true, user: true, store: true },
      orderBy: { placedAt: "asc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <AutoRefresh />
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Dashboard</h1>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}><strong>{stats.activeOrders}</strong>orders to handle</div>
        <div className={styles.stat}><strong>{stats.ordersToday}</strong>orders today</div>
        <div className={styles.stat}><strong>{money(stats.revenueTodayCents)}</strong>sales today</div>
        <div className={styles.stat}><strong>{stats.lowStock.length}</strong>items low on stock</div>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Orders to handle</h2>
        {active.length === 0 ? (
          <p className={styles.muted}>No open orders right now. New ones appear here automatically.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Order</th><th>Status</th><th>Placed</th><th>Customer</th><th>Store</th><th>Items</th><th>Total</th></tr>
            </thead>
            <tbody>
              {active.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`}>#{o.id}</Link></td>
                  <td><span className={styles.badge} data-status={o.status}>{STATUS_LABEL[o.status]}</span></td>
                  <td>{when(o.placedAt)}</td>
                  <td>{o.user.name}</td>
                  <td>{o.store.name}</td>
                  <td>{o.items.reduce((n, i) => n + i.quantity, 0)}</td>
                  <td>{money(o.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Low on stock</h2>
        {stats.lowStock.length === 0 ? (
          <p className={styles.muted}>Everything is well stocked.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Product</th><th>Store</th><th>Left</th></tr></thead>
            <tbody>
              {stats.lowStock.map((row) => (
                <tr key={row.id}>
                  <td>{row.product.title}</td>
                  <td>{row.store.name}</td>
                  <td className={row.quantity === 0 ? styles.low : undefined}>{row.quantity === 0 ? "Sold out" : row.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p><Link className={styles.buttonSecondary} href="/admin/stock">Update stock</Link></p>
      </section>
    </>
  );
}
