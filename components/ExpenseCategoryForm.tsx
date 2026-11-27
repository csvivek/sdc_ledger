"use client";

import { useActionState } from "react";
import { changeExpenseCategory, type ExpenseCategoryState } from "@/app/actions";

/** Admin only: a small "Change category" form under one expense. */
export function ExpenseCategoryForm({ id, current, categories }: { id: string; current: string; categories: string[] }) {
  const [state, action, pending] = useActionState<ExpenseCategoryState, FormData>(changeExpenseCategory, {});
  // A hidden category is still shown for this entry, so the select matches what is saved.
  const options = categories.includes(current) ? categories : [current, ...categories];
  return (
    <details className="change-cat">
      <summary>Change category</summary>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <select name="category" defaultValue={current} aria-label="New category">
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </form>
      {state.error && <p className="err">{state.error}</p>}
      {state.ok && <p className="ok">✓ {state.ok}</p>}
    </details>
  );
}
