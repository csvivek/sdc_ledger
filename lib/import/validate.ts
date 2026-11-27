// Checks an uploaded file before anything is read into the ledger. Only two
// kinds of file are accepted: the clinic's HDFC account statement and the
// PappyJoe "Payments" export. Everything else is turned away with a message
// that says what it looks like and what was expected.

import { isHdfcStatement } from "./hdfc";
import { isPappyJoePayments } from "./pappyjoe";

export type ImportKind = "HDFC" | "PAPPYJOE";
type Cell = string | number | null | undefined;

export const KIND_LABEL: Record<ImportKind, string> = {
  HDFC: "HDFC bank statement",
  PAPPYJOE: "PappyJoe Payments export",
};

export const EXPECTED: Record<ImportKind, string> = {
  HDFC: "the HDFC account statement (.xls) exactly as downloaded from net banking",
  PAPPYJOE: "the PappyJoe Payments export (.xlsx), one per clinic",
};

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));

/**
 * Looks at the file name and the first bytes. Returns a message when the file
 * cannot be an Excel workbook (a PDF, a photo, a CSV, a Word file renamed .xls).
 */
export function checkFileShape(name: string, buf: Uint8Array): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  const what = (() => {
    if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) return "a PDF";
    if (startsWith(buf, [0xff, 0xd8, 0xff])) return "a photo (JPEG)";
    if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return "an image (PNG)";
    if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return "an image (GIF)";
    if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "an image (WebP)";
    if (ascii(buf, 4, 8) === "ftyp") return "a photo or video (HEIC/MP4)";
    return "";
  })();
  if (what) return `This is ${what}, not an Excel file.`;
  if (ext !== "xls" && ext !== "xlsx") return `Only Excel files (.xls or .xlsx) can be imported; this is a .${ext || "file without an extension"}.`;
  // Real Excel files are either the old binary format (.xls) or a zip (.xlsx).
  const ole = startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const zip = startsWith(buf, [0x50, 0x4b, 0x03, 0x04]);
  if (!ole && !zip) return "This is not a real Excel file (it may be a text, CSV or web page saved as .xls).";
  return null;
}

/** Which of the two accepted files this is, or null. */
export function detectKind(rows: Cell[][]): ImportKind | null {
  if (isHdfcStatement(rows)) return "HDFC";
  if (isPappyJoePayments(rows)) return "PAPPYJOE";
  return null;
}

/** A short guess at what an unrecognised file is, to make the rejection message useful. */
export function describeUnknown(rows: Cell[][], sheetCount = 1): string {
  const text = rows
    .slice(0, 60)
    .map((r) => r.map((c) => (c == null ? "" : String(c))).join(" "))
    .join(" \n ");
  if (/credit\s*card|card\s*(no|number)|minimum\s*amount\s*due|payment\s*due\s*date/i.test(text)) return "It looks like a credit card statement.";
  if (/\b(SBI|State Bank|ICICI|Axis|Kotak|Canara|Indian Bank|IOB|Union Bank|Bank of Baroda|Karur Vysya|KVB|City Union|IDFC)\b/i.test(text))
    return "It looks like a statement from another bank. Only the clinic's HDFC account is used.";
  if (/\b(txn|transaction)\s*date\b/i.test(text) && /\b(debit|credit)\b/i.test(text)) return "It looks like a bank statement, but not in the HDFC layout.";
  if (/patient/i.test(text) && /expense/i.test(text)) return "It looks like a PappyJoe expense report. Expenses are entered in this app, not imported.";
  if (/patient/i.test(text)) return "It looks like a PappyJoe report, but not the Payments export (it has no Patient Name and Amount Paid columns).";
  if (/expense|petty\s*cash|salary/i.test(text)) return "It looks like an expense list or accounts workbook. Expenses are entered in this app, not imported.";
  if (sheetCount > 1) return `It is a workbook with ${sheetCount} sheets that is neither of the two expected files.`;
  if (rows.every((r) => r.every((c) => c == null || String(c).trim() === ""))) return "The file is empty.";
  return "It is neither of the two expected files.";
}
