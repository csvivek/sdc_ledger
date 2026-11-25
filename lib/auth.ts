// MOCK LOGIN. Picks a fake user and stores their id in a cookie. There are no
// passwords. To be replaced by Supabase Auth.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getStore } from "./data/store";
import type { User } from "./types";

export const SESSION_COOKIE = "sdc_user";

export async function currentUser(): Promise<User | undefined> {
  const uid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!uid) return undefined;
  const d = await getStore().read();
  return d.users.find((u) => u.id === uid);
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/expenses");
  return u;
}
