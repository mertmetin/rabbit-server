"use client";

import { useActionState } from "react";
import { saveStockAction } from "../../actions";
import styles from "../../admin.module.css";

type Row = { id: number; title: string; image: string; category: string; quantity: number | null };

export function StockForm({ storeId, rows }: { storeId: number; rows: Row[] }) {
  const [state, action, pending] = useActionState(saveStockAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="storeId" value={storeId} />
      <table className={styles.table}>
        <thead><tr><th></th><th>Product</th><th>Category</th><th>In stock</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <td><img className={styles.thumb} src={r.image} alt="" /></td>
              <td>{r.title}</td>
              <td>{r.category}</td>
              <td>
                <input
                  className={`${styles.input} ${styles.qty}`}
                  name={`qty_${r.id}`}
                  type="number"
                  min={0}
                  step={1}
                  defaultValue={r.quantity ?? ""}
                  placeholder="Not carried"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.actions} style={{ marginTop: 16, alignItems: "center" }}>
        <button className={styles.button} disabled={pending}>{pending ? "Saving…" : "Save stock"}</button>
        {state?.error && <p className={styles.error}>{state.error}</p>}
        {state?.ok && <p className={styles.success}>{state.ok}</p>}
      </div>
    </form>
  );
}
