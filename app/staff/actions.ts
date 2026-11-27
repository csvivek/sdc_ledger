"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { getExtras, LastAdminError } from "@/lib/data/extras";
import { NotSetUpError } from "@/lib/data/optional";
import { changedFields } from "@/lib/activity";
import { noteActivity } from "@/lib/note-activity";
import type { ClinicId, Role } from "@/lib/types";

export type PersonFormState = { ok?: string; error?: string };

export async function savePerson(_prev: PersonFormState, formData: FormData): Promise<PersonFormState> {
  const me = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  const role = String(formData.get("role") ?? "") as Role;
  const clinicRaw = String(formData.get("clinic") ?? "");
  const active = formData.get("active") === "1";
  if (!name) return { error: "Type the person's name." };
  if (name.length > 80) return { error: "Please keep the name under 80 letters." };
  if (role !== "admin" && role !== "staff") return { error: "Pick admin or staff." };
  if (clinicRaw && clinicRaw !== "SDC1" && clinicRaw !== "SDC2") return { error: "Pick a clinic." };
  const clinic = (clinicRaw || undefined) as ClinicId | undefined;
  if (id === me.id && !active) return { error: "You cannot switch off your own login. Ask another admin, or switch off a different login." };
  if (id === me.id && role !== "admin") return { error: "You cannot remove your own admin role here. Make someone else admin first, then ask them." };

  const x = getExtras();
  try {
    const { people } = await x.listPeople();
    const before = people.find((p) => p.id === id);
    if (!before) return { error: "That person was not found. Please refresh the page." };
    const unchanged = before.name === name && before.role === role && (before.clinic ?? undefined) === clinic && before.active === active;
    if (unchanged) return { ok: "Nothing to change." };
    await x.updatePerson(id, { name, role, clinic, active });
    const c = changedFields(
      { name: before.name, role: before.role, clinic: before.clinic ?? null, active: before.active },
      { name, role, clinic: clinic ?? null, active },
    );
    await noteActivity(me, "change", "profiles", id, { before: { ...c.before, name: before.name }, after: c.after });
  } catch (err) {
    if (err instanceof LastAdminError) return { error: "This would leave no active admin. Make someone else admin first." };
    if (err instanceof NotSetUpError) return { error: "Switching a login off needs the staff SQL to be run first. Other changes can be saved." };
    console.error("savePerson failed", err);
    return { error: "Could not save. Please try again." };
  }
  revalidatePath("/staff");
  return { ok: active ? `Saved ${name}.` : `Saved. ${name} can no longer log in or add expenses.` };
}
