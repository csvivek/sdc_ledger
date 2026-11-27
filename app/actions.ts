"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStore } from "@/lib/data/store";
import { requireAdmin, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { noteActivity } from "@/lib/note-activity";
import { PAYEE_KINDS, type ClinicId, type ClinicOrShared, type InPappyJoe, type PaidBy, type PayeeKind } from "@/lib/types";

export type LoginState = { error?: string };

/** Real login with email and password (Supabase configured). */
export async function loginWithPassword(_prev: LoginState, formData: FormData): Promise<LoginState> {
  if (!isSupabaseConfigured) return { error: "Logins are not set up yet." };
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { error: "Wrong email or password." };
  redirect("/");
}

/** MOCK login: pick a fake user (prototype only). */
export async function login(formData: FormData) {
  if (isSupabaseConfigured) redirect("/login");
  const uid = String(formData.get("user") ?? "");
  const d = await getStore().read();
  const u = d.users.find((x) => x.id === uid && x.active !== false);
  if (!u) redirect("/login");
  (await cookies()).set(SESSION_COOKIE, u.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect(u.role === "admin" ? "/dashboard" : "/expenses");
}

export async function logout() {
  if (isSupabaseConfigured) await (await createClient()).auth.signOut();
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export type ExpenseFormState = { ok?: string; error?: string };

export async function addExpense(_prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  const user = await requireUser();
  const amount = Number(formData.get("amount"));
  const category = String(formData.get("category") ?? "");
  const clinic = String(formData.get("clinic") ?? "") as ClinicOrShared;
  const paidBy = String(formData.get("paidBy") ?? "") as PaidBy;
  const date = String(formData.get("date") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  let pettyCashClinic = String(formData.get("pettyCashClinic") ?? "") as ClinicId | "";
  const payeeChoice = String(formData.get("payeeId") ?? "");
  const newPayeeName = String(formData.get("newPayeeName") ?? "").trim().replace(/\s+/g, " ");
  const invoiceNo = String(formData.get("invoiceNo") ?? "").trim();
  const inPappyJoe = String(formData.get("inPappyJoe") ?? "") as InPappyJoe;

  let d: Awaited<ReturnType<ReturnType<typeof getStore>["formOptions"]>>;
  try {
    d = await getStore().formOptions();
  } catch (err) {
    console.error("addExpense: could not load form options", err);
    return { error: "Could not save. Please try again." };
  }
  if (!(amount > 0)) return { error: "Enter an amount above zero." };
  if (!d.categories.includes(category)) return { error: "Pick a category." };
  if (!["SDC1", "SDC2", "SHARED"].includes(clinic)) return { error: "Pick a clinic." };
  if (!["PETTY_CASH", "UPI", "BANK"].includes(paidBy)) return { error: "Pick how it was paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a date." };
  if (!["YES", "NO", "NA"].includes(inPappyJoe)) return { error: "Say whether this is already entered in PappyJoe." };

  // Salary, Lab and Consultant ask who was paid. The kind comes from the
  // category, never from the browser.
  const kind = d.categoryPayeeKind[category];
  let payeeId: string | undefined;
  if (kind) {
    if (payeeChoice === "__new__") {
      if (!newPayeeName) return { error: "Type the new name." };
      if (newPayeeName.length > 100) return { error: "That name is too long." };
    } else {
      const p = d.payees.find((x) => x.id === payeeChoice && x.kind === kind);
      if (!p) return { error: "Pick who this was paid to." };
      payeeId = p.id;
    }
  }
  const needsInvoice = d.invoiceCategories.includes(category);
  if (needsInvoice) {
    if (!invoiceNo) return { error: "Enter the invoice number." };
    if (invoiceNo.length > 60) return { error: "That invoice number is too long." };
  }

  if (paidBy === "PETTY_CASH") {
    if (clinic !== "SHARED") pettyCashClinic = clinic;
    if (pettyCashClinic !== "SDC1" && pettyCashClinic !== "SDC2")
      return { error: "Pick which clinic's petty cash paid for it." };
  }

  let payeeName = "";
  try {
    if (kind && !payeeId) {
      const p = await getStore().addPayee(kind, newPayeeName, user.id);
      payeeId = p.id;
      payeeName = p.name;
    } else if (payeeId) {
      payeeName = d.payees.find((x) => x.id === payeeId)?.name ?? "";
    }
    const saved = await getStore().addExpense({
      date,
      amount,
      category,
      clinic,
      paidBy,
      pettyCashClinic: paidBy === "PETTY_CASH" ? (pettyCashClinic as ClinicId) : undefined,
      note,
      payeeId,
      invoiceNo: needsInvoice ? invoiceNo : undefined,
      inPappyJoe,
      enteredBy: user.id,
    });
    await noteActivity(user, "add", "expenses", saved.id, { after: saved });
  } catch (err) {
    console.error("addExpense failed", err);
    return { error: "Could not save. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: `Saved ₹${amount.toLocaleString("en-IN")} for ${category}${payeeName ? ` (${payeeName})` : ""}.` };
}

export async function addPayeeAdmin(formData: FormData) {
  const user = await requireAdmin();
  const kind = String(formData.get("kind") ?? "");
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ");
  if (!(PAYEE_KINDS as string[]).includes(kind) || !name || name.length > 100) return;
  const p = await getStore().addPayee(kind as PayeeKind, name, user.id);
  await noteActivity(user, "add", "payees", p.id, { after: p });
  revalidatePath("/payees");
}

export async function togglePayeeActive(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const active = formData.get("active") === "1";
  await getStore().setPayeeActive(id, active);
  await noteActivity(user, "change", "payees", id, { before: { active: !active }, after: { active } });
  revalidatePath("/payees");
}

// ---------------------------------------------------------------------------
// Expense categories (admin only)
// ---------------------------------------------------------------------------

export type CategoryFormState = { ok?: string; error?: string };

/** Used when a bank payment has no category yet, so it must always exist and stay on offer. */
const FALLBACK_CATEGORY = "Miscellaneous";

const cleanCategoryName = (v: FormDataEntryValue | null) => String(v ?? "").trim().replace(/\s+/g, " ");

function checkCategoryName(name: string): string | undefined {
  if (!name) return "Type a name for the category.";
  if (name.length > 60) return "Please keep the name under 60 letters.";
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export async function addCategoryAdmin(_prev: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const user = await requireAdmin();
  const name = cleanCategoryName(formData.get("name"));
  const bad = checkCategoryName(name);
  if (bad) return { error: bad };
  try {
    const all = await getStore().listCategories();
    const existing = all.find((c) => sameName(c.name, name));
    if (existing) {
      return {
        error: existing.active
          ? `"${existing.name}" is already in the list, so there is nothing to add.`
          : `"${existing.name}" is already in the list but hidden. Use "Show again" below to bring it back.`,
      };
    }
    await getStore().addCategory(name);
    await noteActivity(user, "add", "categories", name, { after: { name } });
  } catch (err) {
    console.error("addCategoryAdmin failed", err);
    return { error: "Could not add the category. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: `Added "${name}". It is now offered on the expense form and for bank payments.` };
}

export async function renameCategoryAdmin(_prev: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const user = await requireAdmin();
  const oldName = String(formData.get("oldName") ?? "");
  const name = cleanCategoryName(formData.get("name"));
  const bad = checkCategoryName(name);
  if (bad) return { error: bad };
  if (name === oldName) return {};
  if (oldName === FALLBACK_CATEGORY) return { error: `"${FALLBACK_CATEGORY}" is used for anything not yet sorted, so it keeps its name.` };
  try {
    const all = await getStore().listCategories();
    if (!all.some((c) => c.name === oldName)) return { error: "That category was not found. Please refresh the page." };
    const clash = all.find((c) => c.name !== oldName && sameName(c.name, name));
    if (clash) return { error: `"${clash.name}" already exists${clash.active ? "" : " (hidden)"}. Please pick a different name.` };
    await getStore().renameCategory(oldName, name);
    await noteActivity(user, "change", "categories", name, { before: { name: oldName }, after: { name } });
  } catch (err) {
    console.error("renameCategoryAdmin failed", err);
    return { error: "Could not rename. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: `Renamed to "${name}". Old entries now show the new name too.` };
}

export async function toggleCategoryActive(_prev: CategoryFormState, formData: FormData): Promise<CategoryFormState> {
  const user = await requireAdmin();
  const name = String(formData.get("name") ?? "");
  const active = formData.get("active") === "1";
  if (!active && name === FALLBACK_CATEGORY) return { error: `"${FALLBACK_CATEGORY}" is used for anything not yet sorted, so it cannot be hidden.` };
  try {
    const all = await getStore().listCategories();
    if (!all.some((c) => c.name === name)) return { error: "That category was not found. Please refresh the page." };
    await getStore().setCategoryActive(name, active);
    await noteActivity(user, "change", "categories", name, { before: { name, active: !active }, after: { active } });
  } catch (err) {
    console.error("toggleCategoryActive failed", err);
    return { error: "Could not save. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: active ? `"${name}" is offered again.` : `"${name}" is hidden. Old entries keep it.` };
}

export async function toggleCardCredited(formData: FormData) {
  const user = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const credited = formData.get("credited") === "1";
  const card = await getStore().markCardCredited(id, credited ? new Date().toISOString().slice(0, 10) : undefined);
  await noteActivity(user, "change", "card_payments", id, { before: { patientRef: card?.patientRef, amount: card?.amount }, after: { credited_on: card?.creditedOn ?? null } });
  revalidatePath("/card-income");
}

export async function resetDemoData() {
  await requireAdmin();
  if (isSupabaseConfigured) return;
  await getStore().reset();
  revalidatePath("/", "layout");
}
