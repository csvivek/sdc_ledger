import Image from "next/image";
import { redirect } from "next/navigation";
import { currentUser, isSwitchedOff } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { PasswordLoginForm } from "@/components/PasswordLoginForm";
import { login, logout } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const me = await currentUser();
  if (isSwitchedOff(me)) {
    return (
      <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
        <Image src="/sdc-logo.png" alt="Sarada Dental Care" width={600} height={225} priority className="login-logo" />
        <h1>Login switched off</h1>
        <p>The doctor has switched off the login for {me?.name}. Ask the doctor if you still need it.</p>
        <form action={logout}>
          <button type="submit" className="full">Log out</button>
        </form>
      </div>
    );
  }
  if (isSupabaseConfigured) {
    if (me) redirect("/");
    return (
      <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
        <Image src="/sdc-logo.png" alt="Sarada Dental Care" width={600} height={225} priority className="login-logo" />
        <h1>Log in</h1>
        <PasswordLoginForm />
        <p className="muted" style={{ marginTop: 16 }}>
          No account? Ask the doctor to add you.
        </p>
      </div>
    );
  }

  const d = await getStore().read();
  return (
    <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
      <Image src="/sdc-logo.png" alt="Sarada Dental Care" width={600} height={225} priority className="login-logo" />
      <h1>Log in</h1>
      <p className="mock-note">
        Mock login: pick a user. No password. Real logins switch on once Supabase is connected.
      </p>
      <form action={login}>
        <div className="chips" style={{ flexDirection: "column", alignItems: "stretch" }}>
          {d.users.filter((u) => u.active !== false).map((u, i) => (
            <label key={u.id}>
              <input type="radio" name="user" value={u.id} defaultChecked={i === 0} />
              {u.name} <span className="muted">({u.role === "admin" ? "sees everything" : "expense entry only"})</span>
            </label>
          ))}
        </div>
        <button type="submit" className="full">Continue</button>
      </form>
    </div>
  );
}
