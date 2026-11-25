"use client";

import { useActionState } from "react";
import { loginWithPassword, type LoginState } from "@/app/actions";

export function PasswordLoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginWithPassword, {});
  return (
    <form action={action}>
      <label htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required />
      <button type="submit" className="full" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </button>
      {state.error && <p className="err">{state.error}</p>}
    </form>
  );
}
