"use client";

import { useActionState, useState } from "react";
import { deleteImportedMonth, previewMonthDelete, type MonthDeleteState } from "@/app/import/actions";
import { inr, monthLabel } from "@/lib/calc";

export type MonthOptions = Record<string, string[]>; // target -> months with imported data, newest first

const TARGETS: [string, string][] = [
  ["HDFC", "Bank statement (HDFC)"],
  ["PAPPYJOE:SDC1", "PappyJoe · SDC1 Podanur"],
  ["PAPPYJOE:SDC2", "PappyJoe · SDC2 Malumichampatti"],
];

/**
 * Two steps: "Show what will be deleted" (changes nothing), then type the
 * month and press Delete. The delete uses the month and source that were
 * previewed, even if the pickers were changed afterwards.
 */
export function MonthDeleteForm({ months }: { months: MonthOptions }) {
  const [target, setTarget] = useState("HDFC");
  const [preview, previewAction, previewing] = useActionState<MonthDeleteState, FormData>(previewMonthDelete, {});
  const [result, deleteAction, deleting] = useActionState<MonthDeleteState, FormData>(deleteImportedMonth, {});
  const list = months[target] ?? [];
  const p = preview.preview;
  const shownTarget = p ? (p.source === "HDFC" ? "HDFC" : `PAPPYJOE:${p.clinic}`) : "";
  const fresh = (result.at ?? 0) > (preview.at ?? 0);
  const deletedThis = !!result.done && fresh;

  return (
    <div className="card">
      <form action={previewAction}>
        <label htmlFor="del-target">What to delete</label>
        <select id="del-target" name="target" value={target} onChange={(e) => setTarget(e.target.value)}>
          {TARGETS.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
        <label htmlFor="del-month">Month</label>
        {list.length ? (
          <select id="del-month" name="month" key={target} defaultValue={list[0]}>
            {list.map((m) => (
              <option key={m} value={m}>{monthLabel(m)}</option>
            ))}
          </select>
        ) : (
          <p className="muted">Nothing imported for this yet.</p>
        )}
        <button type="submit" className="secondary" disabled={previewing || !list.length}>
          {previewing ? "Checking…" : "Show what will be deleted"}
        </button>
        {preview.error && <p className="err">{preview.error}</p>}
      </form>

      {p && !deletedThis && (
        <form action={deleteAction} className="delete-preview">
          <input type="hidden" name="target" value={shownTarget} />
          <input type="hidden" name="month" value={p.month} />
          {p.rows === 0 ? (
            <p>There is no imported data for {p.label} in {monthLabel(p.month)}.</p>
          ) : (
            <>
              <p>
                <strong>This deletes {p.rows} {p.label}</strong> for {monthLabel(p.month)} ({p.firstDate} to {p.lastDate}):
              </p>
              <ul>
                {p.source === "HDFC" ? (
                  <>
                    <li>Credits {inr(p.moneyIn)} and debits {inr(p.moneyOut)}.</li>
                    {p.handAnswered > 0 && (
                      <li>
                        {p.handAnswered} debit(s) you categorised by hand without a rule will need your answer again after re-import.
                      </li>
                    )}
                  </>
                ) : (
                  <>
                    <li>Payments {inr(p.moneyIn)}{p.moneyOut ? `, negative lines ${inr(p.moneyOut)}` : ""}.</li>
                    {p.cards > 0 && <li>{p.cards} pending card payment(s) made from these receipts go too; re-import adds them back.</li>}
                  </>
                )}
                <li>
                  Not touched: expenses entered in the app, payees, categories, bank rules, reconciliation notes and petty cash.
                </li>
              </ul>
              {p.creditedCards > 0 ? (
                <p className="err">
                  This cannot be deleted yet: {p.creditedCards} card payment(s) from this month are marked as credited on Card income.
                  Untick them there first so that answer is not lost.
                </p>
              ) : (
                <>
                  <label htmlFor="del-confirm">Type {p.month} to confirm</label>
                  <input id="del-confirm" name="confirm" autoComplete="off" inputMode="numeric" required />
                  <button type="submit" className="danger" disabled={deleting}>
                    {deleting ? "Deleting…" : `Delete ${monthLabel(p.month)}`}
                  </button>
                </>
              )}
            </>
          )}
          {fresh && result.error && <p className="err">{result.error}</p>}
        </form>
      )}
      {deletedThis && <p className="ok">{result.done}</p>}
    </div>
  );
}
