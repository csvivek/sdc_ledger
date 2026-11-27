import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { PAYEE_KIND_LABEL, PAYEE_KINDS, type PayeeKind } from "@/lib/types";
import { addPayeeAdmin, togglePayeeActive } from "../actions";

export const dynamic = "force-dynamic";

const KINDS = PAYEE_KINDS;
const HEADING: Record<PayeeKind, string> = { staff: "Staff (salary)", lab: "Labs", pharma: "Pharmacies / suppliers", supplier: "Dental materials suppliers", consultant: "Consultants", landlord: "Landlords / other vendors" };

export default async function PayeesPage() {
  await requireAdmin();
  const d = await getStore().read();

  return (
    <>
      <h1>Payees</h1>
      <p className="muted">
        Names offered on the expense form for Salary, Lab, Pharma, Dental materials and Consultant. Landlords and other vendors are kept here for reference. Staff can also add a new name while entering an
        expense. Hidden names stay on old entries but are no longer offered.
      </p>

      <div className="card form-card">
        <form action={addPayeeAdmin}>
          <label htmlFor="kind">Type</label>
          <select id="kind" name="kind" required defaultValue="staff">
            {KINDS.map((k) => (
              <option key={k} value={k}>{PAYEE_KIND_LABEL[k]}</option>
            ))}
          </select>
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" required maxLength={100} autoComplete="off" />
          <button type="submit" className="full">Add name</button>
        </form>
      </div>

      {KINDS.map((k) => {
        const list = d.payees.filter((p) => p.kind === k).sort((a, b) => a.name.localeCompare(b.name));
        return (
          <section key={k}>
            <h2>{HEADING[k]}</h2>
            <div className="table-wrap">
              <table className="list">
                <tbody>
                  {list.length === 0 && (
                    <tr>
                      <td className="muted">No names yet.</td>
                    </tr>
                  )}
                  {list.map((p) => (
                    <tr key={p.id}>
                      <td>{p.active ? p.name : <span className="muted">{p.name} (hidden)</span>}</td>
                      <td className="num">
                        <form action={togglePayeeActive}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="active" value={p.active ? "0" : "1"} />
                          <button type="submit" className="link">{p.active ? "Hide" : "Show again"}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
