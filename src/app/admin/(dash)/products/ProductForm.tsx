"use client";

import { useActionState, useState } from "react";
import { saveProductAction } from "../../actions";
import styles from "../../admin.module.css";

type Category = { id: number; title: string; parent: string | null };
type Product = { id: number; title: string; description: string; price: string; categoryId: number; image: string; taxable: boolean };

export function ProductForm({ product, categories, created }: { product?: Product; categories: Category[]; created?: boolean }) {
  const [state, action, pending] = useActionState(saveProductAction, created ? { ok: "Product added." } : undefined);
  const [image, setImage] = useState(product?.image ?? "");

  return (
    <form action={action} className={styles.form}>
      {product && <input type="hidden" name="id" value={product.id} />}
      <label className={styles.field}>
        Name (add the size after a comma, e.g. &ldquo;2% milk, 2 L&rdquo;)
        <input className={styles.input} name="title" defaultValue={product?.title} required maxLength={191} />
      </label>
      <label className={styles.field}>
        Description
        <textarea className={styles.input} name="description" defaultValue={product?.description} rows={3} />
      </label>
      <div className={styles.row2}>
        <label className={styles.field}>
          Price ($)
          <input className={styles.input} name="price" type="number" step="0.01" min="0.01" defaultValue={product?.price} required />
        </label>
        <label className={styles.field}>
          Category
          <select className={styles.input} name="categoryId" defaultValue={product?.categoryId ?? ""} required>
            <option value="" disabled>Choose…</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.parent ? `${c.parent} › ${c.title}` : c.title}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.field}>
        Photo link (https://…)
        <input className={styles.input} name="image" type="url" value={image} onChange={(e) => setImage(e.target.value)} required />
      </label>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image.startsWith("https://") && <img className={styles.preview} src={image} alt="Preview" />}
      <label className={styles.check}>
        <input type="checkbox" name="taxable" defaultChecked={product?.taxable ?? false} />
        Charge HST (leave off for basic groceries, which are zero-rated)
      </label>
      {state?.error && <p className={styles.error}>{state.error}</p>}
      {state?.ok && <p className={styles.success}>{state.ok}</p>}
      <div className={styles.actions}>
        <button className={styles.button} disabled={pending}>{pending ? "Saving…" : product ? "Save changes" : "Add product"}</button>
      </div>
    </form>
  );
}
