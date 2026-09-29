import { db } from "@/lib/db";

// Categories for the product form: top-level ones and their subcategories.
export async function categoryOptions() {
  const all = await db.productCategory.findMany({ include: { parent: true }, orderBy: [{ sortOrder: "asc" }, { title: "asc" }] });
  const hasChildren = new Set(all.map((c) => c.parentId).filter(Boolean));
  // Products go in a subcategory when one exists, otherwise the category itself.
  return all
    .filter((c) => !hasChildren.has(c.id))
    .map((c) => ({ id: c.id, title: c.title, parent: c.parent?.title ?? null }))
    .sort((a, b) => (a.parent ?? a.title).localeCompare(b.parent ?? b.title));
}
