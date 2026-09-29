import Link from "next/link";
import { ProductForm } from "../ProductForm";
import { categoryOptions } from "../categories";
import styles from "../../../admin.module.css";

export default async function NewProductPage() {
  return (
    <>
      <p className={styles.muted}><Link href="/admin/products">← Products</Link></p>
      <h1 className={styles.pageTitle}>Add product</h1>
      <p className={styles.muted}>After adding it, set how many each store has on the Stock page.</p>
      <section className={styles.card}>
        <ProductForm categories={await categoryOptions()} />
      </section>
    </>
  );
}
