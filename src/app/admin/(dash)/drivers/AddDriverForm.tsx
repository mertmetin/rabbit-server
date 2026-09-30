"use client";

import { useActionState } from "react";
import { addDriverAction } from "../../actions";
import styles from "../../admin.module.css";

export function AddDriverForm() {
  const [state, action, pending] = useActionState(addDriverAction, undefined);
  return (
    <form action={action} className={styles.form}>
      <div className={styles.row2}>
        <label className={styles.field}>
          Phone
          <input className={styles.input} name="phone" type="tel" placeholder="(613) 555-0100" required />
        </label>
        <label className={styles.field}>
          Name
          <input className={styles.input} name="name" placeholder="First and last name" />
        </label>
      </div>
      {state?.error && <p className={styles.error}>{state.error}</p>}
      {state?.ok && <p className={styles.success}>{state.ok}</p>}
      <div className={styles.actions}>
        <button className={styles.button} disabled={pending}>{pending ? "Adding…" : "Add driver"}</button>
      </div>
    </form>
  );
}
