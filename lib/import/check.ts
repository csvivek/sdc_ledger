// Everything that has to be true about an uploaded file before any of it is
// saved. Pure: reads the file and the ledger as it is now, writes nothing.

import { parseHdfc, todayIST } from "./hdfc";
import { parsePappyJoe, type ParsedReceipt } from "./pappyjoe";
import { readWorkbook } from "./read-sheet";
import { classify } from "./rules";
import { checkFileShape, describeUnknown, detectKind, EXPECTED, KIND_LABEL, type ImportKind } from "./validate";
import type { BankRule, BankTxn, ClinicId, PjReceipt } from "../types";

export const MAX_FILE = 4 * 1024 * 1024;
const MAX_ERRORS_SHOWN = 5;

export type CheckedFile =
  | { ok: false; lines: string[] }
  | { ok: true; kind: "HDFC"; txns: Omit<BankTxn, "id">[]; lines: string[] }
  | { ok: true; kind: "PAPPYJOE"; clinic: ClinicId; receipts: ParsedReceipt[]; lines: string[] };

export interface Existing {
  bankTxns: Pick<BankTxn, "date" | "fingerprint">[];
  pjReceipts: Pick<PjReceipt, "clinic" | "receiptNo" | "date" | "amount" | "mode">[];
  bankRules: BankRule[];
}

const shortList = (errors: string[]) =>
  errors.length > MAX_ERRORS_SHOWN ? [...errors.slice(0, MAX_ERRORS_SHOWN), `…and ${errors.length - MAX_ERRORS_SHOWN} more problem(s).`] : errors;

const notImported = (...lines: string[]): CheckedFile => ({ ok: false, lines: ["Not imported. Nothing from this file was saved.", ...lines] });

/**
 * Checks one file uploaded in the box for `expected`. On any doubt it says why
 * and returns ok: false, and the caller saves nothing from that file.
 */
export function checkUpload(expected: ImportKind, name: string, data: Uint8Array, existing: Existing, today = todayIST()): CheckedFile {
  const expectLine = `This box takes ${EXPECTED[expected]}.`;
  if (data.length === 0) return notImported("The file is empty.", expectLine);
  if (data.length > MAX_FILE) return notImported("The file is larger than 4 MB, so it is not one of the expected files.", expectLine);
  const shape = checkFileShape(name, data);
  if (shape) return notImported(shape, expectLine);

  let rows, sheetCount;
  try {
    ({ rows, sheetCount } = readWorkbook(data));
  } catch {
    return notImported("The file could not be opened as an Excel workbook. It may be damaged or password protected.", expectLine);
  }

  const kind = detectKind(rows);
  if (!kind) return notImported(describeUnknown(rows, sheetCount), expectLine);
  if (kind !== expected)
    return notImported(`This is ${kind === "HDFC" ? "an" : "a"} ${KIND_LABEL[kind]}, but it was put in the box for the ${KIND_LABEL[expected]}. Upload it in the box for the ${KIND_LABEL[kind]} instead.`);

  if (kind === "HDFC") {
    const p = parseHdfc(rows, today);
    if (p.errors.length) return notImported("The statement did not read cleanly:", ...shortList(p.errors), "Upload the statement exactly as downloaded from HDFC net banking.");
    const overlap = bankOverlap(p.rows, existing.bankTxns);
    if (overlap.error) return notImported(overlap.error);
    const txns = p.rows.map((r) => ({ ...r, ...classify(r, existing.bankRules) }));
    return { ok: true, kind, txns, lines: [...p.checks, ...overlap.notes] };
  }

  const p = parsePappyJoe(rows, name, today);
  if (p.errors.length || !p.clinic) return notImported("The PappyJoe file did not read cleanly:", ...shortList(p.errors));
  const changed = changedReceipts(p.clinic, p.rows, existing.pjReceipts);
  const lines = [...p.warnings];
  if (changed.length)
    lines.push(
      `${changed.length} receipt(s) were imported before with a different date, amount or payment type (${changed.slice(0, 3).join(", ")}${changed.length > 3 ? ", …" : ""}). The earlier values were kept. If PappyJoe was corrected, delete that month's PappyJoe data below and import again.`,
    );
  return { ok: true, kind, clinic: p.clinic, receipts: p.rows, lines };
}

/**
 * When the ledger already has bank rows on the dates this statement covers,
 * they must be the same rows. If not one matches, it is a different account
 * (or an edited file), and importing it would mix two accounts together.
 */
export function bankOverlap(rows: Pick<BankTxn, "date" | "fingerprint">[], existing: Existing["bankTxns"]): { error?: string; notes: string[] } {
  if (!rows.length) return { notes: [] };
  const dates = rows.map((r) => r.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  const inRange = existing.filter((t) => t.date >= first && t.date <= last);
  if (!inRange.length) return { notes: [] };
  const mine = new Set(rows.map((r) => r.fingerprint));
  const same = inRange.filter((t) => mine.has(t.fingerprint)).length;
  if (same === 0 && inRange.length >= 3)
    return {
      error: `The ledger already has ${inRange.length} bank rows between ${first} and ${last}, and none of them are in this file. This looks like a different bank account or an edited statement, so nothing was imported.`,
      notes: [],
    };
  const missing = inRange.length - same;
  return {
    notes: missing
      ? [`${missing} bank row(s) already in the ledger for these dates are not in this file. They were left as they are.`]
      : [],
  };
}

/** Receipt numbers already imported for the clinic whose date, amount or mode is now different. */
export function changedReceipts(clinic: ClinicId, rows: ParsedReceipt[], existing: Existing["pjReceipts"]): string[] {
  const have = new Map(existing.filter((r) => r.clinic === clinic).map((r) => [r.receiptNo, r]));
  return rows
    .filter((r) => {
      const old = have.get(r.receiptNo);
      return old && (old.date !== r.date || Math.abs(old.amount - r.amount) > 0.005 || old.mode !== r.mode);
    })
    .map((r) => r.receiptNo);
}
