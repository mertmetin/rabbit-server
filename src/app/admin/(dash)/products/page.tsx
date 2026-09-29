import Link from "next/link";
import { db } from "@/lib/db";
import { money } from "../../format";
import styles from "../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const [products, stores] = await Promise.all([
    db.product.findMany({
      where: query ? { title: { contains: query } } : undefined,
      include: { category: { include: { parent: true } }, inventory: true },
      orderBy: { title: "asc" },
    }),
    db.store.findMany({ where: { active: true }, orderBy: { id: "asc" } }),
  ]);

  return (
    <>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Products <span className={styles.muted}>({products.length})</span></h1>
        <Link className={styles.button} href="/admin/products/new">+ Add product</Link>
      </div>
      <form className={styles.tabs}>
        <input className={styles.input} name="q" placeholder="Search products" defaultValue={query} />
        <button className={styles.buttonSecondary}>Search</button>
      </form>
      <section className={styles.card}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th></th><th>Product</th><th>Category</th><th>Price</th><th>HST</th>
              {stores.map((s) => <th key={s.id}>{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <td><img className={styles.thumb} src={p.image} alt="" /></td>
                <td><Link href={`/admin/products/${p.id}`}>{p.title}</Link></td>
                <td>{p.category.parent ? `${p.category.parent.title} › ` : ""}{p.category.title}</td>
                <td>{money(p.priceCents)}</td>
                <td>{p.taxable ? "Yes" : "—"}</td>
                {stores.map((s) => {
                  const qty = p.inventory.find((i) => i.storeId === s.id)?.quantity;
                  return <td key={s.id} className={qty === 0 ? styles.low : undefined}>{qty ?? "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
