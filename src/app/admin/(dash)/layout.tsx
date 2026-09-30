import Link from "next/link";
import { requireAdmin } from "@/lib/admin-session";
import { logout } from "../actions";
import styles from "../admin.module.css";

export const metadata = { title: "Rabbit admin" };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const admin = await requireAdmin();
  return (
    <div className={styles.shell}>
      <nav className={styles.sidebar}>
        <div className={styles.brand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={34} height={34} />
          Rabbit
        </div>
        <Link className={styles.navLink} href="/admin">Dashboard</Link>
        <Link className={styles.navLink} href="/admin/orders">Orders</Link>
        <Link className={styles.navLink} href="/admin/products">Products</Link>
        <Link className={styles.navLink} href="/admin/stock">Stock</Link>
        <Link className={styles.navLink} href="/admin/drivers">Drivers</Link>
        <div className={styles.sidebarFooter}>
          <div>{admin.name}</div>
          <form action={logout}>
            <button className={styles.linkButton}>Sign out</button>
          </form>
        </div>
      </nav>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
