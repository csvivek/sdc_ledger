// Matching between the three sources, worked out fresh every time a page
// loads (a month is a few hundred rows, so this is quick and never goes stale):
//
//   1. PappyJoe UPI receipts  <->  bank UPI credits   (one to one, same amount,
//      bank date up to 3 days either side of the receipt; then a patient's
//      receipts on one day added together; then two UPI credits that add up
//      to one receipt). Bank UPI cannot tell the clinics apart, so both
//      clinics' receipts are matched against the one account.
//   2. PappyJoe cash          ->   cash deposits, compared as monthly totals
//      (cash goes in as a few lumps). Expenses are never paid from patient
//      cash: they come out of petty cash, which is funded only by the bank
//      transfers (per Vivek), so petty cash gets its own balance per clinic.
//   3. PappyJoe card          ->   "pending" until a matching non-UPI credit
//      (or a UPI from the doctor's account) shows up, or the admin marks it.
//   4. Portal expenses paid by bank or UPI  <->  bank debits (same amount,
//      within 7 days, same category preferred). Bank debits with no portal
//      entry still count as expenses, so nothing is missed or counted twice.
//
// The "already in PappyJoe?" answer on an expense is shown next to it as a
// hint only; it never decides a match.

import type { BankTxn, ClinicId, Expense, LedgerData, MonthKey, PjReceipt } from "./types";
import { pettyCashMonth } from "./calc";

const DAY = 86400000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const monthOf = (date: string) => date.slice(0, 7);
const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** The doctor's own HDFC account number appears in transfers to and from it. */
export const DOCTOR_ACCOUNT_HINT = "50200018147135";

export interface UpiMatch {
  receipts: PjReceipt[];
  txns: BankTxn[];
  how: "exact" | "patient-day-total" | "split-payment";
}

export interface ExpenseMatch {
  expense: Expense;
  txn: BankTxn;
}

export interface Matches {
  upi: UpiMatch[];
  upiReceiptMatched: Set<string>;
  upiTxnMatched: Set<string>;
  expense: ExpenseMatch[];
  expenseMatched: Set<string>;
  debitMatched: Set<string>;
  /** card_payments.id -> bank credit that looks like it paid it in. */
  cardCredit: Map<string, BankTxn>;
}

// Offsets tried in order: same day first, then the day after, etc.
const UPI_OFFSETS = [0, 1, -1, 2, -2, 3, -3];

function matchUpi(receipts: PjReceipt[], txns: BankTxn[]) {
  const out: UpiMatch[] = [];
  const usedR = new Set<string>();
  const usedT = new Set<string>();
  const rs = receipts.filter((r) => r.mode === "UPI" && r.amount > 0).sort((a, b) => a.date.localeCompare(b.date) || a.receiptNo.localeCompare(b.receiptNo));
  const ts = txns.filter((t) => t.kind === "UPI_IN").sort((a, b) => a.date.localeCompare(b.date));

  // Pass 1: one receipt = one credit.
  for (const off of UPI_OFFSETS) {
    for (const r of rs) {
      if (usedR.has(r.id)) continue;
      const t = ts.find((t) => !usedT.has(t.id) && eq(t.deposit, r.amount) && days(r.date, t.date) === off);
      if (t) {
        usedR.add(r.id);
        usedT.add(t.id);
        out.push({ receipts: [r], txns: [t], how: "exact" });
      }
    }
  }

  // Pass 2: a patient's receipts on one day, paid as one transfer.
  const groups = new Map<string, PjReceipt[]>();
  for (const r of rs) {
    if (usedR.has(r.id)) continue;
    const k = `${r.clinic}|${r.date}|${r.patientId || r.patientName}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const total = g.reduce((s, r) => s + r.amount, 0);
    for (const off of UPI_OFFSETS) {
      const t = ts.find((t) => !usedT.has(t.id) && eq(t.deposit, total) && days(g[0].date, t.date) === off);
      if (t) {
        g.forEach((r) => usedR.add(r.id));
        usedT.add(t.id);
        out.push({ receipts: g, txns: [t], how: "patient-day-total" });
        break;
      }
    }
  }

  // Pass 3: one receipt paid as two UPI transfers.
  for (const r of rs) {
    if (usedR.has(r.id)) continue;
    const near = ts.filter((t) => !usedT.has(t.id) && Math.abs(days(r.date, t.date)) <= 3);
    found: for (let i = 0; i < near.length; i++)
      for (let j = i + 1; j < near.length; j++)
        if (eq(near[i].deposit + near[j].deposit, r.amount)) {
          usedR.add(r.id);
          usedT.add(near[i].id);
          usedT.add(near[j].id);
          out.push({ receipts: [r], txns: [near[i], near[j]], how: "split-payment" });
          break found;
        }
  }
  return { out, usedR, usedT };
}

const DEBIT_KINDS = new Set(["EXPENSE", "UNKNOWN_OUT", "TRANSFER_OUT"]);

function matchExpenses(expenses: Expense[], txns: BankTxn[]) {
  const out: ExpenseMatch[] = [];
  const usedE = new Set<string>();
  const usedT = new Set<string>();
  const es = expenses.filter((e) => e.paidBy === "BANK" || e.paidBy === "UPI").sort((a, b) => a.date.localeCompare(b.date));
  const ts = txns.filter((t) => t.withdrawal > 0 && DEBIT_KINDS.has(t.kind));
  // Best candidates first: same category and closest date.
  const pairs: { e: Expense; t: BankTxn; score: number }[] = [];
  for (const e of es)
    for (const t of ts) {
      if (!eq(e.amount, t.withdrawal)) continue;
      const d = Math.abs(days(e.date, t.date));
      if (d > 7) continue;
      pairs.push({ e, t, score: d + (t.category && t.category !== e.category ? 10 : 0) });
    }
  pairs.sort((a, b) => a.score - b.score);
  for (const p of pairs) {
    if (usedE.has(p.e.id) || usedT.has(p.t.id)) continue;
    usedE.add(p.e.id);
    usedT.add(p.t.id);
    out.push({ expense: p.e, txn: p.t });
  }
  return { out, usedE, usedT };
}

function matchCards(d: LedgerData) {
  const res = new Map<string, BankTxn>();
  const used = new Set<string>();
  const credits = d.bankTxns.filter(
    (t) => t.kind === "OTHER_IN" || (t.kind === "UPI_IN" && t.narration.includes(DOCTOR_ACCOUNT_HINT)),
  );
  for (const c of [...d.cardPayments].sort((a, b) => a.date.localeCompare(b.date))) {
    const t = credits.find((t) => !used.has(t.id) && eq(t.deposit, c.amount) && days(c.date, t.date) >= 0 && days(c.date, t.date) <= 45);
    if (t) {
      used.add(t.id);
      res.set(c.id, t);
    }
  }
  return res;
}

const cache = new WeakMap<LedgerData, Matches>();

export function matches(d: LedgerData): Matches {
  const hit = cache.get(d);
  if (hit) return hit;
  const u = matchUpi(d.pjReceipts, d.bankTxns);
  const x = matchExpenses(d.expenses, d.bankTxns);
  // A UPI credit from the doctor's account used for a card payment is not a patient UPI.
  const m: Matches = {
    upi: u.out,
    upiReceiptMatched: u.usedR,
    upiTxnMatched: u.usedT,
    expense: x.out,
    expenseMatched: x.usedE,
    debitMatched: x.usedT,
    cardCredit: matchCards(d),
  };
  cache.set(d, m);
  return m;
}

/** Bank debits that are expenses but were not entered in the portal. They count in the P&L. */
export function bankOnlyExpenses(d: LedgerData): BankTxn[] {
  const m = matches(d);
  return d.bankTxns.filter((t) => t.kind === "EXPENSE" && !m.debitMatched.has(t.id));
}

export interface MonthRecon {
  month: MonthKey;
  upi: {
    pj: Record<ClinicId, number>;
    pjTotal: number;
    bank: number;
    matchedCount: number;
    matchedAmount: number;
    pjOnly: PjReceipt[];
    bankOnly: BankTxn[];
    loose: UpiMatch[]; // matched in pass 2 or 3, worth a glance
  };
  cash: {
    pj: Record<ClinicId, number>;
    pjTotal: number;
    deposits: BankTxn[];
    deposited: number;
    unexplained: number;
  };
  /** Per clinic: petty cash received and spent this month, and the balance at month end. */
  petty: Record<
    ClinicId,
    {
      opening: number;
      received: number;
      spent: number;
      /** Carried in + received − spent. */
      expected: number;
      /** The month-end count, when someone counted the box. */
      counted?: number;
      difference: number;
      /** The count if there is one, otherwise expected. */
      closing: number;
    }
  >;
  card: {
    receipts: PjReceipt[];
    total: number;
    pending: { id: string; date: string; clinic: ClinicId; patientRef: string; amount: number }[];
    autoCredited: { id: string; amount: number; txn: BankTxn }[];
  };
  expenses: {
    matched: ExpenseMatch[];
    bankOnly: BankTxn[];
    portalOnly: Expense[];
    unknown: BankTxn[];
    pettyCash: BankTxn[];
    otherCredits: BankTxn[];
  };
  reversals: PjReceipt[];
  hasBank: boolean;
  hasPappyJoe: Record<ClinicId, boolean>;
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

/** `m` can be passed in when reconciling many months, so the matching runs once. */
export function reconcileMonth(d: LedgerData, month: MonthKey, m: Matches = matches(d)): MonthRecon {
  const rec = d.pjReceipts.filter((r) => monthOf(r.date) === month);
  const txns = d.bankTxns.filter((t) => monthOf(t.date) === month);
  const byClinic = (rs: PjReceipt[]) => ({
    SDC1: sum(rs.filter((r) => r.clinic === "SDC1"), (r) => r.amount),
    SDC2: sum(rs.filter((r) => r.clinic === "SDC2"), (r) => r.amount),
  });

  const upiR = rec.filter((r) => r.mode === "UPI");
  const upiT = txns.filter((t) => t.kind === "UPI_IN");
  const upiPj = byClinic(upiR);
  const matchedHere = m.upi.filter((x) => x.receipts.some((r) => monthOf(r.date) === month));

  const cashR = rec.filter((r) => r.mode === "CASH");
  const cashPj = byClinic(cashR);
  const deposits = txns.filter((t) => t.kind === "CASH_DEPOSIT");
  // Petty cash: same maths as the Petty cash page (manual transfers plus bank
  // PETTY CASH transfers split equally; leftover carried into the next month).
  const pettyFor = (c: ClinicId) => {
    const p = pettyCashMonth(d, c, month);
    return {
      opening: p.carriedIn,
      received: p.received,
      spent: p.spent,
      expected: p.expected,
      counted: p.count?.counted,
      difference: p.difference,
      closing: p.leftAtEnd,
    };
  };

  const cardR = rec.filter((r) => r.mode === "CARD");
  const cardsHere = d.cardPayments.filter((c) => monthOf(c.date) <= month);
  const pending = cardsHere.filter((c) => !c.creditedOn && !m.cardCredit.has(c.id));
  const autoCredited = d.cardPayments
    .filter((c) => !c.creditedOn && m.cardCredit.has(c.id) && monthOf(c.date) === month)
    .map((c) => ({ id: c.id, amount: c.amount, txn: m.cardCredit.get(c.id)! }));
  const cardCreditIds = new Set([...m.cardCredit.values()].map((t) => t.id));

  const exMonth = d.expenses.filter((e) => monthOf(e.date) === month);
  const pjTotal = upiPj.SDC1 + upiPj.SDC2;
  const cashTotal = cashPj.SDC1 + cashPj.SDC2;
  const deposited = sum(deposits, (t) => t.deposit);

  return {
    month,
    upi: {
      pj: upiPj,
      pjTotal,
      bank: sum(upiT, (t) => t.deposit),
      matchedCount: matchedHere.reduce((s, x) => s + x.receipts.length, 0),
      matchedAmount: sum(matchedHere, (x) => sum(x.receipts, (r) => r.amount)),
      pjOnly: upiR.filter((r) => !m.upiReceiptMatched.has(r.id)),
      bankOnly: upiT.filter((t) => !m.upiTxnMatched.has(t.id) && !cardCreditIds.has(t.id)),
      loose: matchedHere.filter((x) => x.how !== "exact"),
    },
    cash: {
      pj: cashPj,
      pjTotal: cashTotal,
      deposits,
      deposited,
      unexplained: cashTotal - deposited,
    },
    petty: { SDC1: pettyFor("SDC1"), SDC2: pettyFor("SDC2") },
    card: {
      receipts: cardR,
      total: sum(cardR, (r) => r.amount),
      pending,
      autoCredited,
    },
    expenses: {
      matched: m.expense.filter((x) => monthOf(x.expense.date) === month),
      bankOnly: txns.filter((t) => t.kind === "EXPENSE" && !m.debitMatched.has(t.id)),
      portalOnly: exMonth.filter((e) => (e.paidBy === "BANK" || e.paidBy === "UPI") && !m.expenseMatched.has(e.id)),
      unknown: txns.filter((t) => t.kind === "UNKNOWN_OUT" && !m.debitMatched.has(t.id)),
      pettyCash: txns.filter((t) => t.kind === "PETTY_CASH"),
      otherCredits: txns.filter((t) => t.kind === "OTHER_IN" && !cardCreditIds.has(t.id)),
    },
    reversals: rec.filter((r) => r.amount < 0),
    hasBank: txns.length > 0,
    hasPappyJoe: { SDC1: rec.some((r) => r.clinic === "SDC1"), SDC2: rec.some((r) => r.clinic === "SDC2") },
  };
}

const fmt = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** A best guess at why a bank UPI credit has no PappyJoe UPI receipt. A hint for the admin, never applied automatically. */
export function hintForBankUpi(d: LedgerData, t: BankTxn): string {
  if (t.narration.includes(DOCTOR_ACCOUNT_HINT)) return "Came from the doctor's account; maybe a payment she collected and passed on.";
  const near = d.pjReceipts.filter((r) => eq(r.amount, t.deposit) && Math.abs(days(r.date, t.date)) <= 3 && r.mode !== "UPI");
  if (near.length) {
    const r = near[0];
    return `PappyJoe has ${fmt(r.amount)} from ${r.patientName} on ${r.date} as ${r.paymentInfo || r.mode}, not UPI (receipt ${r.receiptNo}).`;
  }
  const far = d.pjReceipts.find((r) => r.mode === "UPI" && eq(r.amount, t.deposit) && Math.abs(days(r.date, t.date)) <= 10 && !matches(d).upiReceiptMatched.has(r.id));
  if (far) return `A PappyJoe UPI receipt of the same amount is on ${far.date} (${far.patientName}); dates are far apart.`;
  return "No PappyJoe receipt of this amount nearby. Receipt not entered, or entered with a different amount.";
}

/** A best guess at why a PappyJoe UPI receipt has no bank credit. */
export function hintForPjUpi(d: LedgerData, r: PjReceipt): string {
  if (r.amount < 0) return "Negative line in PappyJoe (reversal or correction).";
  const far = d.bankTxns.find(
    (t) => t.kind === "UPI_IN" && eq(t.deposit, r.amount) && Math.abs(days(r.date, t.date)) <= 10 && !matches(d).upiTxnMatched.has(t.id),
  );
  if (far) return `A bank UPI credit of the same amount is on ${far.date}; dates are far apart.`;
  return "No bank UPI credit of this amount nearby. Maybe paid to another account (such as the doctor's), or marked UPI by mistake.";
}
