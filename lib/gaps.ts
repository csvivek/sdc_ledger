// Turns the reconciliation's gaps into questions with a fixed set of answers.
//
// Every gap item (a bank UPI credit with no PappyJoe receipt, and so on) asks
// "what happened?". The admin picks one of the answers listed for that kind of
// gap, or types a new one, which is then offered next time too. An answer says
// whether something still needs fixing (and what), or whether nothing does.
//
// Learning, in the same spirit as the bank rules:
//   * The hint the page already worked out picks the suggested answer.
//   * If an earlier item of the same kind (same sender, same patient, same
//     payee) was answered, that answer is suggested instead.
//   * "Use this answer automatically" saves a gap rule: later items with the
//     same sender/patient/payee show as answered without asking. The admin can
//     still change any of them, and can forget the rule.

import { counterparty } from "./import/hdfc";
import { DOCTOR_ACCOUNT_HINT, hintForBankUpi, hintForPjUpi, matches, type MonthRecon } from "./recon";
import type { GapAnswer, GapReason, GapRule, GapType, LedgerData } from "./types";

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
const fmt = (n: number) => (n < 0 ? "-" : "") + "₹" + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 2 });

export const GAP_INFO: Record<GapType, { question: string; short: string }> = {
  UPI_BANK_ONLY: { question: "Why is this bank UPI credit not in PappyJoe?", short: "Bank UPI not in PappyJoe" },
  UPI_PJ_ONLY: { question: "Why is this PappyJoe UPI receipt not in the bank?", short: "PappyJoe UPI not in bank" },
  OTHER_CREDIT: { question: "What is this money received?", short: "Other money received" },
  PORTAL_ONLY: { question: "Why is this portal expense not in the bank?", short: "Portal expense not in bank" },
  PJ_NEGATIVE: { question: "What is this negative line in PappyJoe?", short: "Negative PappyJoe line" },
  CASH_GAP: { question: "Why does the cash collected not match the deposits?", short: "Cash vs deposits" },
};

type SeedReason = Omit<GapReason, "id" | "active"> & { code: string };

/** The answers every gap type starts with. The migration inserts the same rows (same codes). */
export const SEED_GAP_REASONS: SeedReason[] = [
  // Bank UPI credit, no PappyJoe receipt
  { code: "bank_not_entered", gapType: "UPI_BANK_ONLY", label: "Receipt was not entered in PappyJoe", followUp: true, todo: "Add the receipt in PappyJoe as UPI. It matches on the next import." },
  { code: "bank_wrong_mode", gapType: "UPI_BANK_ONLY", label: "Entered in PappyJoe as cash or card, not UPI", followUp: true, todo: "Change the payment mode to UPI in PappyJoe." },
  { code: "bank_wrong_amount", gapType: "UPI_BANK_ONLY", label: "Entered in PappyJoe with a different amount", followUp: true, todo: "Correct the amount in PappyJoe." },
  { code: "bank_date_far", gapType: "UPI_BANK_ONLY", label: "Entered in PappyJoe on a different date", followUp: false },
  { code: "bank_doctor", gapType: "UPI_BANK_ONLY", label: "Money passed on by the doctor (card or other collection)", followUp: false },
  { code: "bank_not_patient", gapType: "UPI_BANK_ONLY", label: "Not patient income (refund, personal or other)", followUp: false },
  // PappyJoe UPI receipt, no bank credit
  { code: "pj_doctor_account", gapType: "UPI_PJ_ONLY", label: "Patient paid to the doctor's account", followUp: true, todo: "Ask the doctor to transfer it to the clinic account." },
  { code: "pj_was_cash", gapType: "UPI_PJ_ONLY", label: "Patient actually paid by cash or card", followUp: true, todo: "Change the payment mode in PappyJoe." },
  { code: "pj_date_far", gapType: "UPI_PJ_ONLY", label: "Bank credit came on a different date", followUp: false },
  { code: "pj_split", gapType: "UPI_PJ_ONLY", label: "Paid in parts, or as one transfer with other receipts", followUp: false },
  { code: "pj_mistake", gapType: "UPI_PJ_ONLY", label: "Entered in PappyJoe by mistake", followUp: true, todo: "Delete or correct the receipt in PappyJoe." },
  // Other money received
  { code: "oc_card", gapType: "OTHER_CREDIT", label: "Card money paid in by the doctor", followUp: true, todo: "Mark the card payment as credited on Card income." },
  { code: "oc_refund", gapType: "OTHER_CREDIT", label: "Refund from a supplier or vendor", followUp: false },
  { code: "oc_interest", gapType: "OTHER_CREDIT", label: "Bank interest or a reversed charge", followUp: false },
  { code: "oc_owner", gapType: "OTHER_CREDIT", label: "Owner's own money put in", followUp: false },
  // Portal expense, not in the bank
  { code: "po_other_account", gapType: "PORTAL_ONLY", label: "Paid from another account (doctor's or personal)", followUp: false },
  { code: "po_other_month", gapType: "PORTAL_ONLY", label: "Paid from the bank in a different month", followUp: false },
  { code: "po_wrong_amount", gapType: "PORTAL_ONLY", label: "Amount typed differently in the portal", followUp: true, todo: "Correct the amount on the portal entry." },
  { code: "po_petty", gapType: "PORTAL_ONLY", label: "Actually paid from petty cash", followUp: true, todo: "Change Paid by to Petty cash on the portal entry." },
  { code: "po_not_paid", gapType: "PORTAL_ONLY", label: "Not paid yet", followUp: true, todo: "Check again after it is paid." },
  // Negative PappyJoe line
  { code: "neg_mode_change", gapType: "PJ_NEGATIVE", label: "Correction: the payment mode was changed", followUp: false },
  { code: "neg_refund", gapType: "PJ_NEGATIVE", label: "Refund to the patient", followUp: false },
  { code: "neg_cancel", gapType: "PJ_NEGATIVE", label: "Cancelled or duplicate receipt", followUp: false },
  { code: "neg_ask", gapType: "PJ_NEGATIVE", label: "Not sure yet", followUp: true, todo: "Ask the doctor what this line means." },
  // Cash collected vs deposited, per month
  { code: "cash_next_month", gapType: "CASH_GAP", label: "The rest was deposited early next month", followUp: false },
  { code: "cash_prev_month", gapType: "CASH_GAP", label: "Includes last month's cash deposited this month", followUp: false },
  { code: "cash_with_doctor", gapType: "CASH_GAP", label: "Cash is still with the doctor or at the clinic", followUp: true, todo: "Deposit it in the HDFC account." },
  { code: "cash_mode_wrong", gapType: "CASH_GAP", label: "Some cash receipts were really UPI or card", followUp: true, todo: "Fix the payment mode in PappyJoe." },
];

export const seedGapReasons = (): GapReason[] => SEED_GAP_REASONS.map((r) => ({ ...r, id: `gr_${r.code}`, active: true }));

/** Same text, ignoring case, spacing and a full stop at the end. Used to decline a duplicate answer. */
export const normaliseReason = (s: string) => s.trim().replace(/\s+/g, " ").replace(/[.!]+$/, "").toLowerCase();

/** Same sender or patient, written the same way. */
const normaliseSignature = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase().slice(0, 200);

export interface GapItem {
  type: GapType;
  key: string;
  date: string;
  amount: number;
  /** The main line, e.g. the sender or patient. */
  title: string;
  /** Extra facts, such as the receipt number. */
  detail: string;
  /** The page's best guess, in words. */
  hint: string;
  /** Code of the built-in answer the hint points to. */
  hintCode?: string;
  /** Items with the same signature are "the same kind" for suggestions and rules. */
  signature?: string;
  /** How the signature reads in "Use this answer automatically for …". */
  signatureLabel?: string;
}

function bankUpiHintCode(d: LedgerData, t: { narration: string; deposit: number; date: string }) {
  if (t.narration.includes(DOCTOR_ACCOUNT_HINT)) return "bank_doctor";
  if (d.pjReceipts.some((r) => eq(r.amount, t.deposit) && Math.abs(days(r.date, t.date)) <= 3 && r.mode !== "UPI")) return "bank_wrong_mode";
  const m = matches(d);
  if (d.pjReceipts.some((r) => r.mode === "UPI" && eq(r.amount, t.deposit) && Math.abs(days(r.date, t.date)) <= 10 && !m.upiReceiptMatched.has(r.id)))
    return "bank_date_far";
  return "bank_not_entered";
}

function pjUpiHintCode(d: LedgerData, r: { amount: number; date: string }) {
  const m = matches(d);
  const far = d.bankTxns.some((t) => t.kind === "UPI_IN" && eq(t.deposit, r.amount) && Math.abs(days(r.date, t.date)) <= 10 && !m.upiTxnMatched.has(t.id));
  return far ? "pj_date_far" : "pj_doctor_account";
}

/** Which sections can be asked about: a gap is only real once both sides are imported. */
export function gapReadiness(r: MonthRecon) {
  const allPj = r.hasPappyJoe.SDC1 && r.hasPappyJoe.SDC2;
  return { upi: r.hasBank && allPj, cash: r.hasBank && allPj, portal: r.hasBank, negative: true };
}

/** Every gap item for the month, in page order. */
export function collectGaps(d: LedgerData, r: MonthRecon): GapItem[] {
  const out: GapItem[] = [];
  const payees = new Map(d.payees.map((p) => [p.id, p.name]));

  for (const x of r.upi.pjOnly) {
    if (!(x.amount > 0)) continue; // negative lines are asked about below
    const who = x.patientId || x.patientName;
    out.push({
      type: "UPI_PJ_ONLY",
      key: x.id,
      date: x.date,
      amount: x.amount,
      title: x.patientName,
      detail: `${x.clinic} · receipt ${x.receiptNo}`,
      hint: hintForPjUpi(d, x),
      hintCode: pjUpiHintCode(d, x),
      signature: who ? normaliseSignature(who) : undefined,
      signatureLabel: who ? `receipts of ${x.patientName}` : undefined,
    });
  }

  for (const t of r.upi.bankOnly) {
    const name = counterparty(t.narration).name;
    out.push({
      type: "UPI_BANK_ONLY",
      key: t.id,
      date: t.date,
      amount: t.deposit,
      title: name || t.narration,
      detail: t.narration,
      hint: hintForBankUpi(d, t),
      hintCode: bankUpiHintCode(d, t),
      signature: name ? normaliseSignature(name) : undefined,
      signatureLabel: name ? `UPI from ${name}` : undefined,
    });
  }

  if (Math.round(r.cash.unexplained) !== 0) {
    const short = r.cash.unexplained > 0;
    out.push({
      type: "CASH_GAP",
      key: r.month,
      date: `${r.month}-01`,
      amount: r.cash.unexplained,
      title: short ? `${fmt(r.cash.unexplained)} collected but not deposited` : `${fmt(-r.cash.unexplained)} more deposited than collected`,
      detail: `Collected ${fmt(r.cash.pjTotal)} · deposited ${fmt(r.cash.deposited)}`,
      hint: short
        ? "Check the first deposits of next month, and whether any cash is still with the doctor or at the clinic."
        : "Usually last month's cash deposited this month.",
      hintCode: short ? "cash_next_month" : "cash_prev_month",
    });
  }

  for (const e of r.expenses.portalOnly) {
    const payee = (e.payeeId && payees.get(e.payeeId)) || "";
    const other = d.bankTxns.find((t) => t.withdrawal > 0 && eq(t.withdrawal, e.amount) && Math.abs(days(e.date, t.date)) <= 45 && !matches(d).debitMatched.has(t.id));
    const sig = `${e.category}|${payee || e.note}`;
    out.push({
      type: "PORTAL_ONLY",
      key: e.id,
      date: e.date,
      amount: e.amount,
      title: `${e.category}${payee ? ` · ${payee}` : ""}`,
      detail: e.note,
      hint: other
        ? `A bank payment of the same amount is on ${other.date} (${counterparty(other.narration).name}).`
        : "No bank payment of this amount nearby. Paid from another account, not paid yet, or typed differently.",
      hintCode: other ? "po_other_month" : undefined,
      signature: normaliseSignature(sig),
      signatureLabel: `${e.category}${payee ? ` paid to ${payee}` : e.note ? ` "${e.note}"` : ""}`,
    });
  }

  for (const t of r.expenses.otherCredits) {
    const name = counterparty(t.narration).name;
    out.push({
      type: "OTHER_CREDIT",
      key: t.id,
      date: t.date,
      amount: t.deposit,
      title: name || t.narration,
      detail: t.narration,
      hint: t.narration.includes(DOCTOR_ACCOUNT_HINT)
        ? "Came from the doctor's account; maybe card money she collected."
        : "Not UPI and not a cash deposit.",
      hintCode: t.narration.includes(DOCTOR_ACCOUNT_HINT) ? "oc_card" : undefined,
      signature: name ? normaliseSignature(name) : undefined,
      signatureLabel: name ? `money from ${name}` : undefined,
    });
  }

  for (const x of r.reversals) {
    const same = d.pjReceipts.filter((y) => y.clinic === x.clinic && y.invoiceNo === x.invoiceNo && y.id !== x.id && x.invoiceNo);
    const modeChange = same.some((y) => y.amount > 0 && y.mode !== x.mode);
    out.push({
      type: "PJ_NEGATIVE",
      key: x.id,
      date: x.date,
      amount: x.amount,
      title: x.patientName,
      detail: `${x.clinic} · receipt ${x.receiptNo} · invoice ${x.invoiceNo} · ${x.paymentInfo}`,
      hint: same.length
        ? `Same invoice: ${same.map((y) => `${fmt(y.amount)} ${y.paymentInfo} (receipt ${y.receiptNo})`).join(", ")}`
        : "No other line on this invoice.",
      hintCode: modeChange ? "neg_mode_change" : "neg_ask",
      signature: x.patientId || x.patientName ? normaliseSignature(x.patientId || x.patientName) : undefined,
      signatureLabel: `negative lines of ${x.patientName}`,
    });
  }
  return out;
}

export interface GapState {
  item: GapItem;
  status: "open" | "answered" | "auto";
  reason?: GapReason;
  answer?: GapAnswer;
  rule?: GapRule;
  /** The amount when it was answered, if the gap has changed since (it is asked again). */
  changedFrom?: number;
  /** The answer to pre-select, and why. */
  suggestion?: { reasonId: string; why: string };
}

const answerKey = (type: GapType, key: string) => `${type}|${key}`;

/** Where each item stands: answered by the admin, answered by a remembered rule, or waiting. */
export function gapStates(d: LedgerData, items: GapItem[]): GapState[] {
  const reasons = new Map(d.gapReasons.map((r) => [r.id, r]));
  const byCode = new Map(d.gapReasons.filter((r) => r.code && r.active).map((r) => [r.code!, r]));
  const answers = new Map(d.gapAnswers.map((a) => [answerKey(a.gapType, a.itemKey), a]));
  const rules = new Map(d.gapRules.map((r) => [answerKey(r.gapType, r.signature), r]));
  // Most recent answer per signature, for "you chose this last time".
  const lastBySig = new Map<string, GapAnswer>();
  for (const a of [...d.gapAnswers].sort((x, y) => x.answeredAt.localeCompare(y.answeredAt)))
    if (a.signature && reasons.get(a.reasonId)?.active) lastBySig.set(answerKey(a.gapType, a.signature), a);

  return items.map((item): GapState => {
    const answer = answers.get(answerKey(item.type, item.key));
    const answerReason = answer && reasons.get(answer.reasonId);
    if (answer && answerReason) {
      if (eq(answer.amount, item.amount)) return { item, status: "answered", reason: answerReason, answer };
      return {
        item,
        status: "open",
        answer,
        changedFrom: answer.amount,
        suggestion: answerReason.active ? { reasonId: answerReason.id, why: "your earlier answer" } : undefined,
      };
    }
    const rule = item.signature ? rules.get(answerKey(item.type, item.signature)) : undefined;
    const ruleReason = rule && reasons.get(rule.reasonId);
    if (rule && ruleReason) return { item, status: "auto", reason: ruleReason, rule };

    const last = item.signature ? lastBySig.get(answerKey(item.type, item.signature)) : undefined;
    if (last) return { item, status: "open", suggestion: { reasonId: last.reasonId, why: `what you chose last time for ${item.signatureLabel}` } };
    const hinted = item.hintCode ? byCode.get(item.hintCode) : undefined;
    return { item, status: "open", suggestion: hinted ? { reasonId: hinted.id, why: "from the hint" } : undefined };
  });
}

/** The answers offered for a gap type: built-in first, then the admin's own, oldest first. */
export function reasonsFor(d: LedgerData, type: GapType): GapReason[] {
  return d.gapReasons.filter((r) => r.gapType === type && r.active);
}
