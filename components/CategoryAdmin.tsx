"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addCategoryAdmin, renameCategoryAdmin, toggleCategoryActive, type CategoryFormState } from "@/app/actions";
import { PAYEE_KIND_LABEL, type CategoryInfo } from "@/lib/types";

function Feedback({ state }: { state: CategoryFormState }) {
  return (
    <div aria-live="polite">
      {state.ok && <p className="ok">✓ {state.ok}</p>}
      {state.error && <p className="err">{state.error}</p>}
    </div>
  );
}

function AddCategory() {
  const [state, action, pending] = useActionState<CategoryFormState, FormData>(addCategoryAdmin, {});
  const form = useRef<HTMLFormElement>(null);
  // Clear the box after a successful add, keep it after a refusal.
  useEffect(() => {
    if (state.ok) form.current?.reset();
  }, [state]);
  return (
    <div className="card form-card">
      <form ref={form} action={action}>
        <label htmlFor="new-category">New category</label>
        <input id="new-category" name="name" type="text" required maxLength={60} autoComplete="off" placeholder="e.g. IT spend" />
        <button type="submit" className="full" disabled={pending}>{pending ? "Adding…" : "Add category"}</button>
        <Feedback state={state} />
      </form>
    </div>
  );
}

type RowProps = {
  c: CategoryInfo;
  locked: boolean;
  editing: boolean;
  setEditing: (name: string | null) => void;
  rename: (f: FormData) => void;
  toggle: (f: FormData) => void;
  busy: boolean;
};

function CategoryRow({ c, locked, editing, setEditing, rename, toggle, busy }: RowProps) {
  const tags = [c.payeeKind && `asks for ${PAYEE_KIND_LABEL[c.payeeKind].toLowerCase()}`, c.needsInvoice && "asks for invoice no."].filter(Boolean);

  return (
    <tr>
      <td>
        {editing ? (
          <form action={rename} className="rename-form">
            <input type="hidden" name="oldName" value={c.name} />
            <label className="sr-only" htmlFor={`rename-${c.name}`}>New name for {c.name}</label>
            <input id={`rename-${c.name}`} name="name" type="text" required maxLength={60} defaultValue={c.name} autoComplete="off" autoFocus />
            <button type="submit" disabled={busy}>{busy ? "Saving…" : "Save name"}</button>
            <button type="button" className="link" onClick={() => setEditing(null)}>Cancel</button>
          </form>
        ) : c.active ? (
          c.name
        ) : (
          <span className="muted">{c.name} (hidden)</span>
        )}
        {!editing && tags.length > 0 && <div className="muted">{tags.join(", ")}</div>}
      </td>
      <td className="num row-actions">
        {locked ? (
          <span className="muted">Always on</span>
        ) : (
          !editing && (
            <>
              <button type="button" className="link" onClick={() => setEditing(c.name)}>Rename</button>
              {" · "}
              <form action={toggle} style={{ display: "inline" }}>
                <input type="hidden" name="name" value={c.name} />
                <input type="hidden" name="active" value={c.active ? "0" : "1"} />
                <button type="submit" className="link" disabled={busy}>{c.active ? "Hide" : "Show again"}</button>
              </form>
            </>
          )
        )}
      </td>
    </tr>
  );
}

export function CategoryAdmin({ categories }: { categories: CategoryInfo[] }) {
  // One action state for every row, so the message survives the row being
  // re-drawn under its new name after a rename.
  const [renameState, rename, renaming] = useActionState<CategoryFormState, FormData>(renameCategoryAdmin, {});
  const [toggleState, toggle, toggling] = useActionState<CategoryFormState, FormData>(toggleCategoryActive, {});
  const [editing, setEditing] = useState<string | null>(null);
  const [last, setLast] = useState<"rename" | "toggle" | null>(null);

  useEffect(() => {
    if (renameState.ok) setEditing(null);
  }, [renameState]);

  const doRename = (f: FormData) => {
    setLast("rename");
    rename(f);
  };
  const doToggle = (f: FormData) => {
    setLast("toggle");
    toggle(f);
  };
  const notice = last === "rename" ? renameState : last === "toggle" ? toggleState : {};

  const active = categories.filter((c) => c.active);
  const hidden = categories.filter((c) => !c.active);
  return (
    <>
      <AddCategory />
      <Feedback state={notice} />
      {[
        ["In use", active],
        ["Hidden", hidden],
      ].map(([heading, list]) =>
        (list as CategoryInfo[]).length === 0 && heading === "Hidden" ? null : (
          <section key={heading as string}>
            <h2>{heading as string}</h2>
            <div className="table-wrap">
              <table className="list">
                <tbody>
                  {(list as CategoryInfo[]).map((c) => (
                    <CategoryRow
                      key={c.name}
                      c={c}
                      locked={c.name === "Miscellaneous"}
                      editing={editing === c.name}
                      setEditing={setEditing}
                      rename={doRename}
                      toggle={doToggle}
                      busy={renaming || toggling}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ),
      )}
    </>
  );
}
