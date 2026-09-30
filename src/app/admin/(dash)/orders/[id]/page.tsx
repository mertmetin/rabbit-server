import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { NEXT_STATUS, STATUS_LABEL } from "@/lib/admin";
import { advanceOrderAction, cancelOrderAction } from "../../../actions";
import { AutoRefresh } from "../../../AutoRefresh";
import { money, when } from "../../../format";
import styles from "../../../admin.module.css";

export const dynamic = "force-dynamic";

const ADVANCE_LABEL = {
  placed: "Start preparing",
  preparing: "Ready for pickup",
  ready: "Out for delivery",
  out_for_delivery: "Mark delivered",
} as const;

type Address = { label?: string; address_line_1?: string; address_line_2?: string; city?: string; zone_code?: string; postal_code?: string; notes?: string };

export default async function OrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  const id = Number((await params).id);
  const order = Number.isInteger(id)
    ? await db.order.findUnique({ where: { id }, include: { items: { include: { product: true } }, user: true, store: true, driver: true } })
    : null;
  if (!order) notFound();

  const address = (order.deliveryAddress ?? {}) as Address;
  const next = NEXT_STATUS[order.status];
  const canCancel = order.status !== "delivered" && order.status !== "cancelled";

  return (
    <>
      <AutoRefresh seconds={20} />
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.muted}><Link href="/admin/orders">← Orders</Link></p>
          <h1 className={styles.pageTitle}>
            Order #{order.id} <span className={styles.badge} data-status={order.status}>{STATUS_LABEL[order.status]}</span>
          </h1>
        </div>
        <div className={styles.actions}>
          {next && (
            <form action={advanceOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <button className={styles.button}>{ADVANCE_LABEL[order.status as keyof typeof ADVANCE_LABEL]}</button>
            </form>
          )}
          {canCancel && (
            <form action={cancelOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <button className={styles.buttonDanger}>Cancel &amp; refund</button>
            </form>
          )}
        </div>
      </div>

      <div className={styles.detailGrid}>
        <section className={styles.card}>
          <h2 className={styles.cardTitle}>Items to pack</h2>
          <table className={styles.table}>
            <thead><tr><th></th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
            <tbody>
              {order.items.map((item) => (
                <tr key={item.id}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <td><img className={styles.thumb} src={item.product.image} alt="" /></td>
                  <td>{item.title}</td>
                  <td><strong>{item.quantity}</strong></td>
                  <td>{money(item.unitPriceCents)}</td>
                  <td>{money(item.unitPriceCents * item.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className={styles.kv} style={{ marginTop: 16 }}>
            <dt>Subtotal</dt><dd>{money(order.subtotalCents)}</dd>
            <dt>Tax</dt><dd>{money(order.taxCents)}</dd>
            <dt>Total paid</dt><dd><strong>{money(order.totalCents)}</strong></dd>
          </dl>
        </section>

        <div>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Delivery</h2>
            <dl className={styles.kv}>
              <dt>Customer</dt><dd>{order.user.name}</dd>
              <dt>Phone</dt><dd><a href={`tel:+1${order.user.phone}`}>{order.user.phone}</a></dd>
              <dt>Address</dt>
              <dd>
                {address.address_line_1}{address.address_line_2 ? `, ${address.address_line_2}` : ""}<br />
                {address.city} {address.zone_code} {address.postal_code}
              </dd>
              {address.notes && (<><dt>Address notes</dt><dd>{address.notes}</dd></>)}
              {order.notes && (<><dt>Order note</dt><dd>{order.notes}</dd></>)}
              <dt>Options</dt>
              <dd>{[order.contactless && "Contactless", order.noBell && "Don't ring the bell"].filter(Boolean).join(", ") || "—"}</dd>
            </dl>
          </section>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>Details</h2>
            <dl className={styles.kv}>
              <dt>Store</dt><dd>{order.store.name}</dd>
              <dt>Driver</dt><dd>{order.driver ? `${order.driver.name || "Driver"} · ${order.driver.phone}` : "Not assigned yet"}</dd>
              {order.pickedUpAt && (<><dt>Picked up</dt><dd>{when(order.pickedUpAt)}</dd></>)}
              {order.deliveredAt && (<><dt>Delivered</dt><dd>{when(order.deliveredAt)}</dd></>)}
              <dt>Placed</dt><dd>{when(order.placedAt)}</dd>
              <dt>Payment</dt><dd>{order.stripePaymentIntentId ?? "—"}</dd>
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}
