import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getExtras } from "@/lib/data/extras";
import { isSupabaseConfigured, SUPABASE_URL } from "@/lib/supabase/config";
import { CLINIC_LABEL } from "@/lib/types";
import { PersonForm } from "@/components/PersonForm";

export const dynamic = "force-dynamic";

const when = (iso?: string) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "never";

/** The project's Supabase dashboard page for logins, from the public project URL. */
function authUsersLink(): string | undefined {
  const ref = SUPABASE_URL.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  return ref ? `https://supabase.com/dashboard/project/${ref}/auth/users` : undefined;
}

export default async function StaffPage() {
  const me = await requireAdmin();
  const { people, loginInfo } = await getExtras().listPeople();
  const link = authUsersLink();
  const sorted = [...people].sort((a, b) => Number(b.active) - Number(a.active) || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));

  return (
    <>
      <h1>Staff logins</h1>
      <p className="muted">
        Everyone has their own login. <strong>Admin</strong> sees and manages everything. <strong>Staff</strong> can only add expenses and see
        the ones they added. Switching a login off stops it at once without deleting anything it entered. See what each person did on{" "}
        <Link href="/activity">Activity</Link>.
      </p>

      <div className="table-wrap">
        <table className="stack">
          <thead>
            <tr>
              <th>Name</th>
              <th>Can do</th>
              <th>Home clinic</th>
              <th>Login</th>
              <th>Last signed in</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr key={p.id} className={p.active ? "" : "off"}>
                <td className="row-title">
                  {p.name}
                  {p.id === me.id && <span className="tag">you</span>}
                  {p.email && <div className="muted small-text">{p.email}</div>}
                </td>
                <td data-label="Can do">{p.role === "admin" ? "Admin (everything)" : "Staff (add expenses)"}</td>
                <td data-label="Home clinic">{p.clinic ? CLINIC_LABEL[p.clinic] : <span className="muted">none</span>}</td>
                <td data-label="Login">{p.active ? <span className="pos">On</span> : <span className="neg">Off</span>}</td>
                <td data-label="Last signed in">{loginInfo ? when(p.lastSignIn) : <span className="muted">needs the staff SQL</span>}</td>
                <td data-label="">
                  <PersonForm id={p.id} name={p.name} role={p.role} clinic={p.clinic} active={p.active !== false} isMe={p.id === me.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Add a new login</h2>
      <div className="card">
        {isSupabaseConfigured ? (
          <ol>
            <li>
              Open {link ? <a href={link} target="_blank" rel="noreferrer">Supabase &gt; Authentication &gt; Users</a> : "Supabase > Authentication > Users"} and
              press <strong>Add user &gt; Create new user</strong>.
            </li>
            <li>Type their email and a password, tick <strong>Auto Confirm User</strong>, and press Create.</li>
            <li>Come back here and refresh: they appear as Staff. Press Edit to set their name and home clinic.</li>
            <li>Give them the email and password. They can log in on their phone straight away.</li>
          </ol>
        ) : (
          <p className="mock-note">Prototype mode: the people here are fake. Real logins are added in Supabase.</p>
        )}
        <p className="muted">
          New logins are added in Supabase because creating a login needs Supabase&apos;s secret key, which this app deliberately does not hold.
          Everything else about a person is managed here.
        </p>
      </div>
    </>
  );
}
