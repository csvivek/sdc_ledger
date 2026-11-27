import { inr } from "@/lib/calc";
import { GAP_INFO, type GapState } from "@/lib/gaps";
import type { GapReason, GapType } from "@/lib/types";
import { DebitNotices } from "./DebitNotices";
import { GapForm } from "./GapForm";

/**
 * One kind of gap for the month: items waiting for an answer, each with its
 * question, then the answered ones (folded away), with what still needs doing.
 */
export function GapList(props: {
  title: string;
  month: string;
  type: GapType;
  states: GapState[];
  reasons: GapReason[];
  /** False when a file for the month is missing, so the gap may not be real yet. */
  askable: boolean;
  users: Map<string, string>;
}) {
  const { title, month, type, reasons, askable, users } = props;
  const states = props.states.filter((s) => s.item.type === type);
  if (!states.length) return null;
  const open = states.filter((s) => s.status === "open");
  const done = states.filter((s) => s.status !== "open");
  const toFix = done.filter((s) => s.reason?.followUp);
  const total = states.reduce((s, x) => s + x.item.amount, 0);
  const question = GAP_INFO[type].question;

  return (
    <DebitNotices>
      <div className="gap-group" id={`gaps-${type}`}>
        <div className="section-head">
          <strong>
            {title} ({inr(total)})
          </strong>
          <span>
            {open.length > 0 && <span className="badge open">{open.length} to answer</span>}{" "}
            {toFix.length > 0 && <span className="badge warn">{toFix.length} to fix</span>}{" "}
            {done.length - toFix.length > 0 && <span className="badge done">{done.length - toFix.length} explained</span>}
          </span>
        </div>
        {!askable && (
          <p className="muted">Import the missing files for this month first. These may match then, so they are not asked yet.</p>
        )}
        {open.map((s) => (
          <div key={s.item.key} className="card gap-item">
            <Head s={s} />
            {s.changedFrom !== undefined && (
              <p className="notice">
                This changed from {inr(s.changedFrom)} to {inr(s.item.amount)} since it was answered. Please check the answer again.
              </p>
            )}
            {askable && (
              <GapForm
                month={month}
                gapType={type}
                itemKey={s.item.key}
                question={question}
                reasons={reasons}
                suggested={s.suggestion}
                note={s.answer?.note}
                signatureLabel={s.item.signatureLabel}
              />
            )}
          </div>
        ))}
        {done.length > 0 && (
          <details open={open.length === 0 && toFix.length > 0}>
            <summary>Answered ({done.length})</summary>
            {done.map((s) => (
              <div key={s.item.key} className="gap-item answered">
                <Head s={s} />
                <p className="gap-answer">
                  <span className={`badge ${s.reason?.followUp ? "warn" : "done"}`}>{s.reason?.followUp ? "To fix" : "Explained"}</span>{" "}
                  <strong>{s.reason?.label}</strong>
                  {s.reason?.followUp && s.reason.todo && <span> · {s.reason.todo}</span>}
                </p>
                <p className="muted">
                  {s.status === "auto"
                    ? `Answered automatically: remembered for ${s.item.signatureLabel}.`
                    : `Answered${s.answer?.answeredBy && users.get(s.answer.answeredBy) ? ` by ${users.get(s.answer.answeredBy)}` : ""} on ${s.answer?.answeredAt.slice(0, 10)}.`}
                  {s.answer?.note ? ` Note: ${s.answer.note}` : ""}
                </p>
                {askable && (
                  <details>
                    <summary className="muted">Change</summary>
                    <GapForm
                      month={month}
                      gapType={type}
                      itemKey={s.item.key}
                      question={question}
                      reasons={reasons}
                      selected={s.reason?.active ? s.reason.id : undefined}
                      note={s.answer?.note}
                      signatureLabel={s.status === "auto" ? undefined : s.item.signatureLabel}
                    />
                  </details>
                )}
              </div>
            ))}
          </details>
        )}
      </div>
    </DebitNotices>
  );
}

function Head({ s }: { s: GapState }) {
  const { item } = s;
  return (
    <div className="gap-head">
      <div className="gap-title">
        <strong className={item.amount < 0 ? "neg" : ""}>{inr(item.amount)}</strong>
        {item.type !== "CASH_GAP" && <span className="muted"> {item.date}</span>} <span className="wrap">{item.title}</span>
      </div>
      {item.detail && <div className="muted narration">{item.detail}</div>}
      <div className="gap-hint">Hint: {item.hint}</div>
    </div>
  );
}
