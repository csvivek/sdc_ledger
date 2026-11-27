"use client";

import { useActionState, useState } from "react";
import { savePerson, type PersonFormState } from "@/app/staff/actions";
import { CLINIC_LABEL, type ClinicId, type Role } from "@/lib/types";

interface Props {
  id: string;
  name: string;
  role: Role;
  clinic?: ClinicId;
  active: boolean;
  isMe: boolean;
}

export function PersonForm(p: Props) {
  const [state, action, pending] = useActionState<PersonFormState, FormData>(savePerson, {});
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <>
        <button type="button" className="secondary small" onClick={() => setOpen(true)}>Edit</button>
        {state.ok && <p className="ok">✓ {state.ok}</p>}
      </>
    );
  return (
    <form action={action} className="person-form">
      <input type="hidden" name="id" value={p.id} />
      <label htmlFor={`pn-${p.id}`}>Name</label>
      <input id={`pn-${p.id}`} name="name" defaultValue={p.name} required maxLength={80} autoComplete="off" />
      <label htmlFor={`pr-${p.id}`}>Can do</label>
      <select id={`pr-${p.id}`} name="role" defaultValue={p.role} disabled={p.isMe}>
        <option value="staff">Staff: add expenses only</option>
        <option value="admin">Admin: sees and manages everything</option>
      </select>
      {p.isMe && <input type="hidden" name="role" value={p.role} />}
      <label htmlFor={`pc-${p.id}`}>Home clinic (the expense form starts with it)</label>
      <select id={`pc-${p.id}`} name="clinic" defaultValue={p.clinic ?? ""}>
        <option value="">None</option>
        <option value="SDC1">{CLINIC_LABEL.SDC1}</option>
        <option value="SDC2">{CLINIC_LABEL.SDC2}</option>
      </select>
      <label htmlFor={`pa-${p.id}`}>Login</label>
      <select id={`pa-${p.id}`} name="active" defaultValue={p.active ? "1" : "0"} disabled={p.isMe}>
        <option value="1">On: can log in</option>
        <option value="0">Off: cannot log in or add expenses</option>
      </select>
      {p.isMe && <input type="hidden" name="active" value="1" />}
      {p.isMe && <p className="muted">This is you: you cannot switch off your own login or admin role.</p>}
      <div className="row-actions">
        <button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        <button type="button" className="link" onClick={() => setOpen(false)}>Close</button>
      </div>
      <div aria-live="polite">
        {state.ok && <p className="ok">✓ {state.ok}</p>}
        {state.error && <p className="err">{state.error}</p>}
      </div>
    </form>
  );
}
