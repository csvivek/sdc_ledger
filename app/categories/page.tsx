import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { CategoryAdmin } from "@/components/CategoryAdmin";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  await requireAdmin();
  const categories = await getStore().listCategories();

  return (
    <>
      <h1>Expense categories</h1>
      <p className="muted">
        The list offered on the expense form, when answering a bank payment, and in bank rules. A new category also shows up on the dashboard and
        P&amp;L as soon as something is spent on it. Hiding a category stops it being offered, but old entries and reports keep it.
      </p>
      <CategoryAdmin categories={categories} />
    </>
  );
}
