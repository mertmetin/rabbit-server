import Link from "next/link";
import type { OrderStatus } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_STATUSES, STATUS_LABEL } from "@/lib/admin";
import { AutoRefresh } from "../../AutoRefresh";
import { money, when } from "../../format";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

const FILTERS: Record<string, { label: string; statuses: OrderStatus[] }> = {
  active: { label: "Open", statuses: ACTIVE_STATUSES },
  delivered: { label: "Delivered", statuses: ["delivered"] },
  cancelled: { label: "Cancelled", statuses: ["cancelled"] },
  all: { label: "All", statuses: ["placed", "preparing", "ready", "out_for_delivery", "delivered", "cancelled"] },
};

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const { show } = await searchParams;
  const key = typeof show === "string" && show in FILTERS ? show : "active";
  const orders = await db.order.findMany({
    where: { status: { in: FILTERS[key].statuses } },
    include: { items: true, user: true, store: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <>
      <AutoRefresh />
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Orders</h1>
      </div>
      <div className={styles.tabs}>
        {Object.entries(FILTERS).map(([k, f]) => (
          <Link key={k} href={`/admin/orders?show=${k}`} className={`${styles.tab} ${k === key ? styles.tabActive : ""}`}>{f.label}</Link>
        ))}
      </div>
      <section className={styles.card}>
        {orders.length === 0 ? (
          <p className={styles.muted}>No orders here.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Order</th><th>Status</th><th>Placed</th><th>Customer</th><th>Store</th><th>Items</th><th>Total</th></tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`}>#{o.id}</Link></td>
                  <td><span className={styles.badge} data-status={o.status}>{STATUS_LABEL[o.status]}</span></td>
                  <td>{when(o.placedAt ?? o.createdAt)}</td>
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
    </>
  );
}
