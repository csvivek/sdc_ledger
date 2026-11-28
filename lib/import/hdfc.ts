// Reads an HDFC "Account Statement" export (.xls / .xlsx, as downloaded from
// net banking). The file has about 20 lines of account details, then a header
// row "Date | Narration | Chq./Ref.No. | Value Dt | Withdrawal Amt. |
// Deposit Amt. | Closing Balance", a line of asterisks, the transactions, more
// asterisks and a STATEMENT SUMMARY. Extra columns (such as a hand-written
// PURPOSE column) are ignored.

export interface ParsedBankRow {
  date: string; // YYYY-MM-DD
  narration: string;
  refNo: string;
  valueDate: string;
  withdrawal: number;
  deposit: number;
  balance: number;
  fingerprint: string;
}

export interface BankSummary {
  opening: number;
  debits: number;
  credits: number;
  closing: number;
  drCount: number;
  crCount: number;
}

export interface ParsedStatement {
  rows: ParsedBankRow[];
  summary?: BankSummary;
  /** Problems that mean the file should not be trusted as read. */
  errors: string[];
  /** Totals check against the statement's own summary. */
  checks: string[];
}

type Cell = string | number | null | undefined;

const str = (c: Cell) => (c == null ? "" : String(c)).trim();
const num = (c: Cell) => {
  if (typeof c === "number") return c;
  const s = str(c).replace(/,/g, "");
  return s ? Number(s) : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "01/10/26" or "01/10/2026" -> "2026-10-01". Empty string when it is not a real calendar date. */
export function ddmmyy(c: Cell): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(str(c));
  if (!m) return "";
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return realDate(y, Number(m[2]), Number(m[1]));
}

/** "YYYY-MM-DD" when the day exists (no 31/02), else "". */
export function realDate(y: number, mo: number, d: number): string {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return "";
  return t.toISOString().slice(0, 10);
}

/** Today in India, as YYYY-MM-DD. */
export function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

/** Earliest date the app accepts in an import; older dates mean a misread file. */
export const EARLIEST_DATE = "2020-01-01";

export function isHdfcStatement(rows: Cell[][]): boolean {
  return findHeader(rows) >= 0;
}

// The seven columns of the HDFC statement, in order.
const HDFC_COLUMNS: [string, RegExp][] = [
  ["Date", /^date$/i],
  ["Narration", /^narration$/i],
  ["Chq./Ref.No.", /^chq.*ref/i],
  ["Value Dt", /^value\s*d/i],
  ["Withdrawal Amt.", /^withdrawal/i],
  ["Deposit Amt.", /^deposit/i],
  ["Closing Balance", /^closing\s*bal/i],
];

function findHeader(rows: Cell[][]): number {
  return rows.findIndex(
    (r) => str(r[0]).toLowerCase() === "date" && str(r[1]).toLowerCase() === "narration" && /withdrawal/i.test(str(r[4])),
  );
}

export function parseHdfc(rows: Cell[][], today = todayIST()): ParsedStatement {
  const errors: string[] = [];
  const checks: string[] = [];
  const h = findHeader(rows);
  if (h < 0) return { rows: [], errors: ["This does not look like an HDFC statement: no Date / Narration header row."], checks };
  const wrongCols = HDFC_COLUMNS.filter(([, re], i) => !re.test(str(rows[h][i])));
  if (wrongCols.length)
    return {
      rows: [],
      errors: [`The column headings are not the usual HDFC ones (expected ${HDFC_COLUMNS.map(([n]) => n).join(" | ")}).`],
      checks,
    };
  // HDFC's name is in the heading of a download, and in the footer (GSTIN line) even if the heading was cut off.
  if (!rows.some((r) => r.some((c) => /\bHDFC\s+BANK\b/i.test(str(c)))))
    return { rows: [], errors: ["This statement does not say HDFC Bank anywhere. Only the clinic's HDFC account statement can be imported."], checks };

  // "Statement From : 01/10/2026 To : 31/10/2026" when the heading is there.
  let from = "";
  let to = "";
  for (const r of rows.slice(0, h)) {
    const m = /Statement\s+From\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})\s+To\s*:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i.exec(r.map(str).join(" "));
    if (m) {
      from = ddmmyy(m[1]);
      to = ddmmyy(m[2]);
    }
  }

  const out: ParsedBankRow[] = [];
  const seen = new Map<string, number>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const first = str(r[0]);
    if (/^\*+$/.test(first) && out.length === 0) continue; // the asterisks under the header
    if (/^\*+$/.test(first) || /STATEMENT SUMMARY/i.test(first)) break;
    if (!first && !str(r[1])) {
      if (out.length) break;
      continue;
    }
    const date = ddmmyy(r[0]);
    if (!date) {
      errors.push(`Row ${i + 1}: could not read the date "${first}".`);
      continue;
    }
    if (date < EARLIEST_DATE || date > today) {
      errors.push(`Row ${i + 1}: the date ${first} is ${date > today ? "in the future" : "too old"}.`);
      continue;
    }
    if (from && to && (date < from || date > to)) {
      errors.push(`Row ${i + 1}: the date ${first} is outside the statement period.`);
      continue;
    }
    const withdrawal = round2(num(r[4]));
    const deposit = round2(num(r[5]));
    const balance = round2(num(r[6]));
    if (![withdrawal, deposit, balance].every(Number.isFinite) || withdrawal < 0 || deposit < 0) {
      errors.push(`Row ${i + 1}: an amount is not a number.`);
      continue;
    }
    if (!(withdrawal > 0) === !(deposit > 0)) {
      errors.push(`Row ${i + 1}: expected exactly one of withdrawal or deposit.`);
      continue;
    }
    const row: ParsedBankRow = {
      date,
      narration: str(r[1]).replace(/\s+/g, " "),
      refNo: str(r[2]),
      valueDate: ddmmyy(r[3]) || date,
      withdrawal,
      deposit,
      balance,
      fingerprint: "",
    };
    // Same date, reference, amount and closing balance = same bank row. The
    // counter keeps two genuinely identical rows apart.
    const base = [row.date, row.refNo, row.withdrawal, row.deposit, row.balance].join("|");
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    row.fingerprint = k > 1 ? `${base}|${k}` : base;
    out.push(row);
  }

  // STATEMENT SUMMARY: a label row, then "Opening Balance ... Debits Credits Closing Bal", then the numbers.
  let summary: BankSummary | undefined;
  const s = rows.findIndex((r) => str(r[0]).toLowerCase() === "opening balance");
  if (s >= 0 && rows[s + 1]) {
    const v = rows[s + 1];
    const counts = rows.slice(s + 2, s + 6).find((r) => typeof r[4] === "number" || /^\d+$/.test(str(r[4])));
    summary = {
      opening: num(v[0]),
      debits: num(v[4]),
      credits: num(v[5]),
      closing: num(v[6]),
      drCount: counts ? num(counts[4]) : NaN,
      crCount: counts ? num(counts[5]) : NaN,
    };
  }

  if (out.length === 0) errors.push("No transactions found in the statement.");
  if (!summary && out.length)
    errors.push("The STATEMENT SUMMARY at the end is missing, so the totals cannot be checked. Upload the statement exactly as downloaded.");
  else if (summary && ![summary.opening, summary.debits, summary.credits, summary.closing].every(Number.isFinite))
    errors.push("The STATEMENT SUMMARY could not be read.");
  if (summary && out.length) {
    const debits = round2(out.reduce((a, r) => a + r.withdrawal, 0));
    const credits = round2(out.reduce((a, r) => a + r.deposit, 0));
    const dr = out.filter((r) => r.withdrawal > 0).length;
    const cr = out.length - dr;
    if (Math.abs(debits - summary.debits) > 0.01 || Math.abs(credits - summary.credits) > 0.01)
      errors.push(
        `Totals do not match the statement summary (read debits ${debits}, credits ${credits}; summary says ${summary.debits}, ${summary.credits}).`,
      );
    else checks.push(`Debits ${debits} and credits ${credits} match the statement summary.`);
    if (!Number.isNaN(summary.drCount) && (dr !== summary.drCount || cr !== summary.crCount))
      errors.push(`Row counts do not match the summary (read ${dr} debits, ${cr} credits).`);
    // Running balance: each row's closing balance follows from the one before.
    let bal = summary.opening;
    for (const r of out) {
      bal = round2(bal - r.withdrawal + r.deposit);
      if (Math.abs(bal - r.balance) > 0.01) {
        errors.push(`Running balance breaks at ${r.date} "${r.narration.slice(0, 40)}".`);
        break;
      }
    }
    if (Math.abs(out[out.length - 1].balance - summary.closing) > 0.01)
      errors.push(`The last closing balance does not match the summary's closing balance (${summary.closing}).`);
  }
  return { rows: out, summary, errors, checks };
}

/** Who a debit went to, or who a credit came from, taken from the narration. Used for display and for new rules. */
export function counterparty(narration: string): { name: string; remark: string } {
  const n = narration.trim();
  const parts = n.split("-");
  if (/^NEFT (DR|CR)-/i.test(n) || /^RTGS (DR|CR)-/i.test(n) || /^IMPS-/i.test(n)) {
    // NEFT DR-IFSC-NAME-NETBANK, MUM-REF-REMARK
    return { name: (parts[2] ?? "").trim(), remark: (parts[parts.length - 1] ?? "").trim() };
  }
  if (/^\d+-TPT-/i.test(n)) {
    // ACCOUNT-TPT-REMARK-NAME (transfer to another HDFC account)
    return { name: (parts[parts.length - 1] ?? "").trim(), remark: parts.slice(2, -1).join("-").trim() };
  }
  if (/^UPI-/i.test(n)) {
    // UPI-ACCOUNT-VPA-REF-REMARK
    return { name: (parts[2] ?? "").trim(), remark: parts.slice(4).join("-").trim() };
  }
  return { name: n, remark: "" };
}

/**
 * A sensible "narration contains" text for a new rule. For a transfer to the
 * doctor's account the remark says what it is for (TPT-SDC FLOWERS-HEMA P),
 * so use that; otherwise the payee's name.
 */
export function suggestPattern(narration: string): string {
  const { name, remark } = counterparty(narration);
  if (/^\d+-TPT-/i.test(narration) && remark) return `TPT-${remark}`;
  return name.length >= 3 ? name : narration;
}
