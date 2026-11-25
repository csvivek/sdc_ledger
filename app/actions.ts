"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getStore } from "@/lib/data/store";
import { requireAdmin, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import type { ClinicId, ClinicOrShared, PaidBy } from "@/lib/types";

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
  const u = d.users.find((x) => x.id === uid);
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

  const d = await getStore().read();
  if (!(amount > 0)) return { error: "Enter an amount above zero." };
  if (!d.categories.includes(category)) return { error: "Pick a category." };
  if (!["SDC1", "SDC2", "SHARED"].includes(clinic)) return { error: "Pick a clinic." };
  if (!["PETTY_CASH", "UPI", "BANK"].includes(paidBy)) return { error: "Pick how it was paid." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick a date." };
  if (paidBy === "PETTY_CASH") {
    if (clinic !== "SHARED") pettyCashClinic = clinic;
    if (pettyCashClinic !== "SDC1" && pettyCashClinic !== "SDC2")
      return { error: "Pick which clinic's petty cash paid for it." };
  }

  try {
    await getStore().addExpense({
      date,
      amount,
      category,
      clinic,
      paidBy,
      pettyCashClinic: paidBy === "PETTY_CASH" ? (pettyCashClinic as ClinicId) : undefined,
      note,
      enteredBy: user.id,
    });
  } catch (err) {
    console.error("addExpense failed", err);
    return { error: "Could not save. Please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: `Saved ₹${amount.toLocaleString("en-IN")} for ${category}.` };
}

export async function saveReconReason(formData: FormData) {
  await requireAdmin();
  const month = String(formData.get("month") ?? "");
  const clinic = String(formData.get("clinic") ?? "") as ClinicId;
  const reason = String(formData.get("reason") ?? "");
  await getStore().setReconReason(month, clinic, reason);
  revalidatePath("/reconciliation");
}

export async function toggleCardCredited(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const credited = formData.get("credited") === "1";
  await getStore().markCardCredited(id, credited ? new Date().toISOString().slice(0, 10) : undefined);
  revalidatePath("/card-income");
}

export async function resetDemoData() {
  await requireAdmin();
  if (isSupabaseConfigured) return;
  await getStore().reset();
  revalidatePath("/", "layout");
}
