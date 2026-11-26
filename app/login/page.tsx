import { getStore } from "@/lib/data/store";
import { login } from "../actions";

export default async function LoginPage() {
  const d = await getStore().read();
  return (
    <div className="card" style={{ maxWidth: 420, margin: "24px auto" }}>
      <h1>Log in</h1>
      <p className="mock-note">
        Mock login: pick a user. No password. Real logins will use Supabase Auth.
      </p>
      <form action={login}>
        <div className="chips" style={{ flexDirection: "column", alignItems: "stretch" }}>
          {d.users.map((u, i) => (
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
