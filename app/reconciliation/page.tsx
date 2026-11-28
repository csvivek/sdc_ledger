import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { inr, monthLabel, monthsIn } from "@/lib/calc";
import { reconcileMonth } from "@/lib/recon";
import { collectGaps, GAP_INFO, gapReadiness, gapStates, reasonsFor } from "@/lib/gaps";
import { counterparty } from "@/lib/import/hdfc";
import { CLINIC_LABEL, IN_PAPPYJOE_LABEL, type GapType, type ReconNote } from "@/lib/types";
import { pickMonth } from "@/components/MonthPicker";
import { BooksBar } from "@/components/BooksBar";
import { DebitForm } from "@/components/DebitForm";
import { DebitNotices } from "@/components/DebitNotices";
import { GapList } from "@/components/GapList";
import { saveReconNote } from "../import/actions";
import { toggleCardCredited } from "../actions";
import { forgetGapRule } from "./actions";

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
      <input name="note" defaultValue={current} placeholder="Note for the month (optional)" aria-label="Note for the month" />
      <button type="submit" className="small">Save</button>
    </form>
  );
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireAdmin();
  const d = await getStore().read();
  // Every month, oldest first: these used to be answered on Import.
  const unknownAll = d.bankTxns.filter((t) => t.kind === "UNKNOWN_OUT").sort((a, b) => a.date.localeCompare(b.date));
  const months = monthsIn(d);
  const month = pickMonth(months, (await searchParams).month);
  const r = reconcileMonth(d, month);
  const bankChanges = await getStore().categoryChanges("bank", r.expenses.bankOnly.map((t) => t.id));
  const lastBankChange = new Map<string, (typeof bankChanges)[number]>();
  for (const c of bankChanges) if (!lastBankChange.has(c.targetId)) lastBankChange.set(c.targetId, c);
  const userName = Object.fromEntries(d.users.map((u) => [u.id, u.name]));
  const users = new Map(d.users.map((u) => [u.id, u.name]));
  const ready = gapReadiness(r);
  const gaps = gapStates(d, collectGaps(d, r));
  const openGaps = gaps.filter((s) => s.status === "open");
  const toFix = gaps.filter((s) => s.status !== "open" && s.reason?.followUp);
  const gapList = (type: GapType, title: string, askable: boolean) => (
    <GapList title={title} month={month} type={type} states={gaps} reasons={reasonsFor(d, type)} askable={askable} users={users} />
  );
  const reasonLabel = new Map(d.gapReasons.map((x) => [x.id, x.label]));

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
      <BooksBar d={d} month={month} active="/reconciliation" />
      {unknownAll.length > 0 && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>Bank payments that need a category ({unknownAll.length})</h2>
          <p className="muted">
            These did not match any rule. Say what each one is. Leave &quot;Remember&quot; ticked and the app will categorise the same kind of
            payment by itself from now on.
          </p>
          <DebitNotices>
            {unknownAll.map((t) => (
              <DebitForm key={t.id} txn={t} categories={d.categories} />
            ))}
          </DebitNotices>
        </section>
      )}
      {missing.length > 0 && (
        <p className="mock-note">
          Not imported for this month yet: {missing.join(", ")}. <Link href="/import">Import files</Link>
        </p>
      )}

      {gaps.length > 0 && (
        <div className={`card gap-summary ${openGaps.length ? "has-open" : ""}`}>
          {openGaps.length > 0 ? (
            <p>
              <strong>{openGaps.length} item(s) need your answer.</strong> For each one, pick what happened (the likely answer is already
              picked), or choose Something else and type it. Answers you type are offered next time.
            </p>
          ) : (
            <p>
              <strong>Every gap this month has an answer.</strong>
            </p>
          )}
          {toFix.length > 0 && (
            <>
              <p>
                <span className="badge warn">{toFix.length} to fix</span> These were answered, but something still needs correcting:
              </p>
              <ul className="gap-todo">
                {toFix.map((s) => (
                  <li key={`${s.item.type}|${s.item.key}`}>
                    {inr(s.item.amount)} {s.item.title} ({GAP_INFO[s.item.type].short}): {s.reason?.todo ?? s.reason?.label}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="chips gap-jump">
            {(Object.keys(GAP_INFO) as GapType[]).map((t) => {
              const n = openGaps.filter((s) => s.item.type === t).length;
              return n ? (
                <a key={t} href={`#gaps-${t}`} className="badge open">
                  {GAP_INFO[t].short}: {n}
                </a>
              ) : null;
            })}
          </div>
        </div>
      )}

      <div className="grid">
        <div className="card stat">
          <div className="label">UPI: PappyJoe minus bank</div>
          <div className={`value ${Math.round(upiDiff) ? "neg" : "pos"}`}>{inr(upiDiff)}</div>
          <div className="muted">{openGaps.filter((s) => s.item.type === "UPI_BANK_ONLY" || s.item.type === "UPI_PJ_ONLY").length} payments to answer</div>
        </div>
        <div className="card stat">
          <div className="label">Cash collected, not yet deposited</div>
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
        {gapList("UPI_BANK_ONLY", "In bank as UPI, not found in PappyJoe", ready.upi)}
        {gapList("UPI_PJ_ONLY", "In PappyJoe as UPI, not found in bank", ready.upi)}
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
        <Line label="Not yet deposited" value={r.cash.unexplained} total neg />
        {r.cash.deposits.length > 0 && (
          <p className="muted">Deposits: {r.cash.deposits.map((t) => `${inr(t.deposit)} on ${t.date}`).join(", ")}.</p>
        )}
        <p className="muted">
          Cash goes in as a few lumps, so this compares month totals. Patient cash is never used for expenses; those come out of
          petty cash, below.
        </p>
        {gapList("CASH_GAP", "Cash gap this month", ready.cash)}
        <Note month={month} topic="CASH" notes={d.reconNotes} />
      </div>

      <h2>Petty cash</h2>
      <div className="card">
        <div className="table-wrap">
          <table className="stack">
            <thead>
              <tr>
                <th></th>
                <th className="num">Start of month</th>
                <th className="num">Received</th>
                <th className="num">Spent</th>
                <th className="num">Expected</th>
                <th className="num">Counted</th>
                <th className="num">End of month</th>
              </tr>
            </thead>
            <tbody>
              {(["SDC1", "SDC2"] as const).map((c) => {
                const p = r.petty[c];
                return (
                  <tr key={c}>
                    <td className="row-title">{CLINIC_LABEL[c]}</td>
                    <td data-label="Start of month" className="num">{inr(p.opening)}</td>
                    <td data-label="Received" className="num">{inr(p.received)}</td>
                    <td data-label="Spent" className="num">{inr(p.spent)}</td>
                    <td data-label="Expected" className="num">{inr(p.expected)}</td>
                    <td data-label="Counted" className="num">
                      {p.counted === undefined ? (
                        <span className="muted">Not counted</span>
                      ) : (
                        <>
                          {inr(p.counted)}
                          {Math.abs(p.difference) >= 0.005 && (
                            <span className="neg">
                              {" "}
                              ({p.difference > 0 ? "+" : "−"}
                              {inr(Math.abs(p.difference))})
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td data-label="End of month" className={`num ${p.closing < 0 ? "neg" : ""}`}>{inr(p.closing)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Received = PETTY CASH transfers to the doctor in the bank statement, split equally between the clinics. Spent = expenses
          entered in the portal as paid from petty cash. Counted = the cash counted in the box at month end; when there is a count,
          the month ends on it and next month starts from it. A negative balance means spending was entered that the transfers do
          not cover. <Link href={`/petty-cash?month=${month}`}>Count or see petty cash</Link>
        </p>
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
          <p className="notice">
            {r.expenses.unknown.length} bank payment(s) this month need a category: answer them at the top of this page.
          </p>
        )}

        {gapList("PORTAL_ONLY", "Entered in the portal as paid by bank/UPI, not found in the bank", ready.portal)}
        {gapList("OTHER_CREDIT", "Other money received (not UPI or cash)", ready.upi)}

        <details>
          <summary>Only in the bank, categorised automatically ({r.expenses.bankOnly.length}, {inr(sum(r.expenses.bankOnly, (t) => t.withdrawal))})</summary>
          <div className="table-wrap">
            <table className="stack">
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
                      <td data-label="Date">{t.date}</td>
                      <td data-label="Paid to" className="wrap">
                        {cp.name}
                        {cp.remark ? <span className="muted"> · {cp.remark}</span> : null}
                      </td>
                      <td data-label="Category" className="wrap cat-td">
                        <span>{t.category}</span>
                        {lastBankChange.has(t.id) && (
                          <span className="cat-history muted">
                            was {lastBankChange.get(t.id)!.oldValue} · changed by {userName[lastBankChange.get(t.id)!.changedBy] ?? "admin"} on{" "}
                            {new Date(lastBankChange.get(t.id)!.changedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}
                          </span>
                        )}
                      </td>
                      <td data-label="Clinic">{t.clinic ? CLINIC_LABEL[t.clinic] : ""}</td>
                      <td data-label="Amount" className="num strong">{inr(t.withdrawal)}</td>
                      <td className="actions">
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
              <table className="stack">
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
                      <td data-label="Portal date">{e.date}</td>
                      <td data-label="Bank date">{t.date}</td>
                      <td data-label="Category">{e.category}</td>
                      <td data-label="Bank says" className="wrap">{counterparty(t.narration).name}</td>
                      <td data-label="In PappyJoe?">{e.inPappyJoe ? IN_PAPPYJOE_LABEL[e.inPappyJoe] : "—"}</td>
                      <td data-label="Amount" className="num strong">{inr(e.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}

        {r.expenses.pettyCash.length > 0 && (
          <p className="muted">
            Petty cash sent to the clinics (not an expense): {r.expenses.pettyCash.map((t) => `${inr(t.withdrawal)} on ${t.date}`).join(", ")}.
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
            {gapList("PJ_NEGATIVE", "Negative lines", true)}
          </div>
        </>
      )}

      {d.gapRules.length > 0 && (
        <>
          <h2>Remembered answers</h2>
          <div className="card">
            <p className="muted">
              Gaps from these senders, patients or payees are answered automatically. Forget one to be asked again.
            </p>
            <div className="table-wrap">
              <table className="list">
                <tbody>
                  {d.gapRules.map((g) => (
                    <tr key={g.id}>
                      <td>{GAP_INFO[g.gapType].short}</td>
                      <td className="wrap">{g.signature}</td>
                      <td className="wrap">{reasonLabel.get(g.reasonId) ?? ""}</td>
                      <td>
                        <form action={forgetGapRule}>
                          <input type="hidden" name="id" value={g.id} />
                          <button type="submit" className="small secondary">Forget</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
