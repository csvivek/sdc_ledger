// Who is logged in.
//
// With Supabase configured: real logins through Supabase Auth, and the role
// (admin or staff) comes from the user's row in public.profiles.
// Without it (prototype): MOCK login that stores a fake user id in a cookie.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getStore } from "./data/store";
import { toUser } from "./data/supabase-store";
import { isSupabaseConfigured } from "./supabase/config";
import { createClient } from "./supabase/server";
import type { User } from "./types";

export const SESSION_COOKIE = "sdc_user";

export const currentUser = cache(async (): Promise<User | undefined> => {
  if (isSupabaseConfigured) {
    const sb = await createClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user) return undefined;
    const { data } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    // A login without a profile row (should not happen; the database trigger
    // creates one) is treated as staff.
    return data ? toUser(data) : { id: user.id, name: user.email ?? "User", role: "staff" };
  }

  const uid = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!uid) return undefined;
  const d = await getStore().read();
  return d.users.find((u) => u.id === uid);
});

/** A login the admin has switched off is treated as logged out (the login page explains why). */
export const isSwitchedOff = (u: User | undefined) => u?.active === false;

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u || isSwitchedOff(u)) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/expenses");
  return u;
}
