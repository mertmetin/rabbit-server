import { db } from "@/lib/db";
import { removeDriverAction } from "../../actions";
import { AutoRefresh } from "../../AutoRefresh";
import { AddDriverForm } from "./AddDriverForm";
import { when } from "../../format";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function DriversPage() {
  const drivers = await db.user.findMany({
    where: { role: "driver" },
    include: {
      driverStore: true,
      deliveries: { where: { status: { in: ["placed", "preparing", "ready", "out_for_delivery"] } } },
    },
    orderBy: [{ driverOnline: "desc" }, { name: "asc" }],
  });

  return (
    <>
      <AutoRefresh seconds={20} />
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Drivers</h1>
      </div>

      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Add a driver</h2>
        <p className={styles.muted}>They sign in to the Rabbit Driver app with this phone number and a text code.</p>
        <AddDriverForm />
      </section>

      <section className={styles.card}>
        {drivers.length === 0 ? (
          <p className={styles.muted}>No drivers yet.</p>
        ) : (
          <table className={styles.table}>
            <thead><tr><th>Driver</th><th>Phone</th><th>Status</th><th>Store</th><th>Carrying</th><th>Last update</th><th></th></tr></thead>
            <tbody>
              {drivers.map((d) => {
                const onTheWay = d.deliveries.find((o) => o.driverLocatedAt);
                return (
                  <tr key={d.id}>
                    <td>{d.name || "—"}</td>
                    <td>{d.phone}</td>
                    <td>
                      <span className={styles.badge} data-status={d.driverOnline ? "placed" : "delivered"}>
                        {d.driverOnline ? "Online" : "Offline"}
                      </span>
                    </td>
                    <td>{d.driverStore?.name ?? "—"}</td>
                    <td>{d.deliveries.length ? d.deliveries.map((o) => `#${o.id}`).join(", ") : "—"}</td>
                    <td>{onTheWay ? when(onTheWay.driverLocatedAt) : d.phoneVerifiedAt ? "—" : "Hasn't signed in yet"}</td>
                    <td>
                      {d.deliveries.length === 0 && (
                        <form action={removeDriverAction}>
                          <input type="hidden" name="userId" value={d.id} />
                          <button className={styles.buttonDanger}>Remove</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
