import { redirect } from "next/navigation";
import { currentAdmin } from "@/lib/admin-session";
import { LoginForm } from "./LoginForm";
import styles from "../admin.module.css";

export const metadata = { title: "Sign in · Rabbit admin" };

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <main className={styles.loginPage}>
      <div className={styles.loginCard}>
        <h1>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={40} height={40} />
          Rabbit admin
        </h1>
        <LoginForm />
      </div>
    </main>
  );
}
