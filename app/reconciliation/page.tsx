import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, monthLabel, monthsIn } from "@/lib/calc";
import { hintForBankUpi, hintForPjUpi, reconcileMonth } from "@/lib/recon";
import { counterparty } from "@/lib/import/hdfc";
import { CLINIC_LABEL, IN_PAPPYJOE_LABEL, PAID_BY_LABEL, type ReconNote } from "@/lib/types";
import { MonthPicker, pickMonth } from "@/components/MonthPicker";
import { DebitForm } from "@/components/DebitForm";
import { saveReconNote } from "../import/actions";
import { toggleCardCredited } from "../actions";

export const dynamic = "force-dynamic";

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

function Line({ label, value, total, neg }: { label: string; value: number; total?: boolean; neg?: boolean }) {
  return (
    <div className={`recon-line ${total ? "total" : ""}`}>
      <span>{label}</span>
      <span className={neg && Math.round(value) !== 0 ? "neg" : ""}>{inr(value)}</span>
    </div>
  );
}

function Note({ month, topic, notes }: { month: string; topic: ReconNote["topic"]; notes: ReconNote[] }) {
  const current = notes.find((n) => n.month === month && n.topic === topic)?.note ?? "";
  return (
    <form action={saveReconNote} className="recon-form">
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="topic" value={topic} />
      <input name="note" defaultValue={current} placeholder="Your explanation for this month (optional)" aria-label="Explanation" />
      <button type="submit" className="small">Save</button>
    </form>
  );
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  const months = monthsIn(d);
  const month = pickMonth(months, (await searchParams).month);
  const r = reconcileMonth(d, month);
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const payees = new Map(d.payees.map((p) => [p.id, p.name]));

  const upiDiff = r.upi.pjTotal - r.upi.bank;
  const explained = sum(r.upi.pjOnly, (x) => x.amount) - sum(r.upi.bankOnly, (t) => t.deposit);
  const timing = upiDiff - explained;
  const cardPendingTotal = sum(r.card.pending, (c) => c.amount);
  const missing = [
    !r.hasBank && "HDFC statement",
    !r.hasPappyJoe.SDC1 && "PappyJoe for Podanur",
    !r.hasPappyJoe.SDC2 && "PappyJoe for Malumichampatti",
  ].filter(Boolean);

  return (
    <>
      <h1>Reconcile {monthLabel(month)}</h1>
      <MonthPicker months={months} active={month} basePath="/reconciliation" />
      {missing.length > 0 && (
        <p className="mock-note">
          Not imported for this month yet: {missing.join(", ")}. <Link href="/import">Import files</Link>
        </p>
      )}

      <div className="grid">
        <div className="card stat">
          <div className="label">UPI: PappyJoe minus bank</div>
          <div className={`value ${Math.round(upiDiff) ? "neg" : "pos"}`}>{inr(upiDiff)}</div>
          <div className="muted">{r.upi.pjOnly.length + r.upi.bankOnly.length} payments to look at</div>
        </div>
        <div className="card stat">
          <div className="label">Cash not deposited or spent</div>
          <div className={`value ${Math.round(r.cash.unexplained) ? "neg" : "pos"}`}>{inr(r.cash.unexplained)}</div>
          <div className="muted">Collected {inr(r.cash.pjTotal)} · deposited {inr(r.cash.deposited)}</div>
        </div>
        <div className="card stat">
          <div className="label">Card money still with the doctor</div>
          <div className={`value ${cardPendingTotal ? "neg" : "pos"}`}>{inr(cardPendingTotal)}</div>
          <div className="muted">{r.card.pending.length} payment(s), up to this month</div>
        </div>
        <div className="card stat">
          <div className="label">Bank payments needing an answer</div>
          <div className={`value ${r.expenses.unknown.length ? "neg" : "pos"}`}>{r.expenses.unknown.length}</div>
          <div className="muted">{r.expenses.portalOnly.length} portal entries not found in bank</div>
        </div>
      </div>

      {/* ---------------- UPI ---------------- */}
      <h2>1. UPI: PappyJoe vs bank</h2>
      <div className="card">
        <Line label={`PappyJoe UPI · ${CLINIC_LABEL.SDC1}`} value={r.upi.pj.SDC1} />
        <Line label={`PappyJoe UPI · ${CLINIC_LABEL.SDC2}`} value={r.upi.pj.SDC2} />
        <Line label="PappyJoe UPI, both clinics" value={r.upi.pjTotal} total />
        <Line label="UPI credits in the HDFC account" value={r.upi.bank} />
        <Line label="Difference" value={upiDiff} total neg />
        <p className="muted">
          The bank cannot tell the clinics apart, so both clinics are matched against the one account, payment by payment (same
          amount, within 3 days). {r.upi.matchedCount} receipts worth {inr(r.upi.matchedAmount)} matched.
          {Math.round(timing) !== 0 && ` ${inr(timing)} of the difference is payments matched across the month end.`}
        </p>
        {r.upi.pjOnly.length > 0 && (
          <>
            <strong>In PappyJoe as UPI, not found in bank ({inr(sum(r.upi.pjOnly, (x) => x.amount))})</strong>
            <div className="table-wrap">
              <table>
                <tbody>
                  {r.upi.pjOnly.map((x) => (
                    <tr key={x.id}>
                      <td>{x.date}</td>
                      <td>{x.clinic}</td>
                      <td>{x.patientName} · receipt {x.receiptNo}</td>
                      <td className="num">{inr(x.amount)}</td>
                      <td className="wrap muted">{hintForPjUpi(d, x)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {r.upi.bankOnly.length > 0 && (
          <>
            <strong>In bank as UPI, not found in PappyJoe ({inr(sum(r.upi.bankOnly, (t) => t.deposit))})</strong>
            <div className="table-wrap">
              <table>
                <tbody>
                  {r.upi.bankOnly.map((t) => (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td>{counterparty(t.narration).name}</td>
                      <td className="num">{inr(t.deposit)}</td>
                      <td className="wrap muted">{hintForBankUpi(d, t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {r.upi.loose.length > 0 && (
          <details>
            <summary className="muted">{r.upi.loose.length} matched by adding payments together (worth a glance)</summary>
            <ul>
              {r.upi.loose.map((m, i) => (
                <li key={i} className="muted">
                  {m.receipts.map((x) => `${x.patientName} ${inr(x.amount)}`).join(" + ")} = bank{" "}
                  {m.txns.map((t) => `${inr(t.deposit)} on ${t.date}`).join(" + ")}
                </li>
              ))}
            </ul>
          </details>
        )}
        <Note month={month} topic="UPI" notes={d.reconNotes} />
      </div>

      {/* ---------------- Cash ---------------- */}
      <h2>2. Cash</h2>
      <div className="card">
        <Line label={`PappyJoe cash · ${CLINIC_LABEL.SDC1}`} value={r.cash.pj.SDC1} />
        <Line label={`PappyJoe cash · ${CLINIC_LABEL.SDC2}`} value={r.cash.pj.SDC2} />
        <Line label="Cash collected, both clinics" value={r.cash.pjTotal} total />
        <Line label={`Deposited in HDFC (${r.cash.deposits.length} deposit${r.cash.deposits.length === 1 ? "" : "s"})`} value={-r.cash.deposited} />
        <Line label="Spent in cash (petty cash expenses entered in the portal)" value={-r.cash.spentTotal} />
        <Line label="Not deposited or explained" value={r.cash.unexplained} total neg />
        {r.cash.deposits.length > 0 && (
          <p className="muted">Deposits: {r.cash.deposits.map((t) => `${inr(t.deposit)} on ${t.date}`).join(", ")}.</p>
        )}
        <p className="muted">
          Cash goes in as a few lumps, so this compares month totals. Cash still in hand at month end shows here until it is deposited.
        </p>
        <Note month={month} topic="CASH" notes={d.reconNotes} />
      </div>

      {/* ---------------- Card ---------------- */}
      <h2>3. Card payments</h2>
      <div className="card">
        <Line label="Card payments in PappyJoe this month" value={r.card.total} />
        {r.card.autoCredited.map((c) => (
          <form key={c.id} action={toggleCardCredited} className="recon-form">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="credited" value="1" />
            <span className="muted" style={{ flex: 1 }}>
              {inr(c.amount)} looks paid in on {c.txn.date} ({counterparty(c.txn.narration).name}).
            </span>
            <button type="submit" className="small">Mark credited</button>
          </form>
        ))}
        {r.card.pending.length > 0 ? (
          <p>
            <span className="badge open">{r.card.pending.length} pending</span> {inr(cardPendingTotal)} not yet seen in the bank.{" "}
            <Link href="/card-income">See card income</Link>
          </p>
        ) : (
          <p className="muted">Nothing pending.</p>
        )}
        <Note month={month} topic="CARD" notes={d.reconNotes} />
      </div>

      {/* ---------------- Expenses ---------------- */}
      <h2>4. Bank payments vs expenses entered in the portal</h2>
      <div className="card">
        <div className="section-head">
          <span>
            <span className="badge done">{r.expenses.matched.length} matched</span>{" "}
            <span className="badge open">{r.expenses.bankOnly.length} only in bank</span>{" "}
            <span className="badge open">{r.expenses.portalOnly.length} only in portal</span>
          </span>
        </div>
        <p className="muted">
          A portal expense paid by bank or UPI is matched to a bank payment of the same amount within 7 days. Bank payments with no
          portal entry still count in the P&amp;L under their category, so nothing is missed or counted twice.
        </p>

        {r.expenses.unknown.length > 0 && (
          <>
            <strong>Needs your answer</strong>
            {r.expenses.unknown.map((t) => (
              <DebitForm key={t.id} txn={t} categories={d.categories} />
            ))}
          </>
        )}

        {r.expenses.portalOnly.length > 0 && (
          <>
            <strong>Entered in the portal as paid by bank/UPI, not found in the bank</strong>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Paid to</th>
                    <th>Paid by</th>
                    <th>In PappyJoe?</th>
                    <th>Entered by</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.expenses.portalOnly.map((e) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>{e.category}</td>
                      <td>{(e.payeeId && payees.get(e.payeeId)) || e.note || "—"}</td>
                      <td>{PAID_BY_LABEL[e.paidBy]}</td>
                      <td>{e.inPappyJoe ? IN_PAPPYJOE_LABEL[e.inPappyJoe] : "—"}</td>
                      <td>{users.get(e.enteredBy) ?? ""}</td>
                      <td className="num">{inr(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">Possible reasons: paid from another account, paid in another month, or the amount was typed differently.</p>
          </>
        )}

        <details>
          <summary>Only in the bank, categorised automatically ({r.expenses.bankOnly.length}, {inr(sum(r.expenses.bankOnly, (t) => t.withdrawal))})</summary>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Paid to</th>
                  <th>Category</th>
                  <th>Clinic</th>
                  <th className="num">Amount</th>
                  <th>Change</th>
                </tr>
              </thead>
              <tbody>
                {r.expenses.bankOnly.map((t) => {
                  const cp = counterparty(t.narration);
                  return (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td className="wrap">
                        {cp.name}
                        {cp.remark ? <span className="muted"> · {cp.remark}</span> : null}
                      </td>
                      <td>{t.category}</td>
                      <td>{t.clinic ? CLINIC_LABEL[t.clinic] : ""}</td>
                      <td className="num">{inr(t.withdrawal)}</td>
                      <td>
                        <details>
                          <summary className="muted">Change</summary>
                          <DebitForm txn={t} categories={d.categories} compact />
                        </details>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>

        {r.expenses.matched.length > 0 && (
          <details>
            <summary>Matched ({r.expenses.matched.length})</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Portal date</th>
                    <th>Bank date</th>
                    <th>Category</th>
                    <th>Bank says</th>
                    <th>In PappyJoe?</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.expenses.matched.map(({ expense: e, txn: t }) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td>{t.date}</td>
                      <td>{e.category}</td>
                      <td className="wrap">{counterparty(t.narration).name}</td>
                      <td>{e.inPappyJoe ? IN_PAPPYJOE_LABEL[e.inPappyJoe] : "—"}</td>
                      <td className="num">{inr(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {(r.expenses.pettyCash.length > 0 || r.expenses.otherCredits.length > 0) && (
          <p className="muted">
            {r.expenses.pettyCash.length > 0 &&
              `Petty cash sent to the clinics (not an expense): ${r.expenses.pettyCash.map((t) => `${inr(t.withdrawal)} on ${t.date}`).join(", ")}. `}
            {r.expenses.otherCredits.length > 0 &&
              `Other money received (not UPI or cash): ${r.expenses.otherCredits.map((t) => `${inr(t.deposit)} on ${t.date}`).join(", ")}.`}
          </p>
        )}
        <Note month={month} topic="EXPENSES" notes={d.reconNotes} />
      </div>

      {/* ---------------- Negative lines ---------------- */}
      {r.reversals.length > 0 && (
        <>
          <h2>5. Negative amounts in PappyJoe (please confirm with the doctor)</h2>
          <div className="card">
            <p className="muted">
              These are counted in the totals above exactly as PappyJoe has them. They often sit next to a positive line for the same
              invoice, for example a payment first saved as cash and then corrected to UPI.
            </p>
            <div className="table-wrap">
              <table>
                <tbody>
                  {r.reversals.map((x) => {
                    const same = d.pjReceipts.filter((y) => y.clinic === x.clinic && y.invoiceNo === x.invoiceNo && y.id !== x.id && x.invoiceNo);
                    return (
                      <tr key={x.id}>
                        <td>{x.date}</td>
                        <td>{x.clinic}</td>
                        <td>{x.patientName} · receipt {x.receiptNo} · invoice {x.invoiceNo}</td>
                        <td>{x.paymentInfo}</td>
                        <td className="num neg">{inr(x.amount)}</td>
                        <td className="wrap muted">
                          {same.length
                            ? `Same invoice: ${same.map((y) => `${inr(y.amount)} ${y.paymentInfo} (receipt ${y.receiptNo})`).join(", ")}`
                            : "No other line on this invoice"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
