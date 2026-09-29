"use client";

import { useActionState } from "react";
import { login } from "../actions";
import styles from "../admin.module.css";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className={styles.form}>
      <label className={styles.field}>
        Phone
        <input className={styles.input} name="phone" type="tel" autoComplete="username" required />
      </label>
      <label className={styles.field}>
        Password
        <input className={styles.input} name="password" type="password" autoComplete="current-password" required />
      </label>
      {state?.error && <p className={styles.error}>{state.error}</p>}
      <button className={styles.button} disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
