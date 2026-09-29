import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ProductForm } from "../ProductForm";
import { categoryOptions } from "../categories";
import styles from "../../../admin.module.css";

export const dynamic = "force-dynamic";

export default async function EditProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const id = Number((await params).id);
  const { created } = await searchParams;
  const product = Number.isInteger(id) ? await db.product.findUnique({ where: { id } }) : null;
  if (!product) notFound();

  return (
    <>
      <p className={styles.muted}><Link href="/admin/products">← Products</Link></p>
      <h1 className={styles.pageTitle}>{product.title}</h1>
      <section className={styles.card}>
        <ProductForm
          created={created === "1"}
          categories={await categoryOptions()}
          product={{
            id: product.id,
            title: product.title,
            description: product.description,
            price: (product.priceCents / 100).toFixed(2),
            categoryId: product.categoryId,
            image: product.image,
            taxable: product.taxable,
          }}
        />
      </section>
      <p><Link className={styles.buttonSecondary} href="/admin/stock">Set stock for this product</Link></p>
    </>
  );
}
