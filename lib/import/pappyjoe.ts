// Reads a PappyJoe "Payments" export (.xlsx), one file per clinic. Columns:
// Date | Patient Name | Receipt No | Invoice No | Invoice Total | Amount Paid |
// Payment Info | Receipt From | Account Type | Details | Receipt By | ...
// "Patient Name" holds the name and the id together, e.g.
// "SANTHOSH KPatient id:- SDCCP3259". SDCCP = Podanur (SDC1), SDCCM =
// Malumichampatti (SDC2).

import type { ClinicId, PayMode } from "../types";

export interface ParsedReceipt {
  date: string;
  patientName: string;
  patientId: string;
  receiptNo: string;
  invoiceNo: string;
  invoiceTotal: number;
  amount: number;
  mode: PayMode;
  paymentInfo: string;
  receiptBy: string;
}

export interface ParsedPappyJoe {
  clinic?: ClinicId;
  rows: ParsedReceipt[];
  errors: string[];
  warnings: string[];
}

type Cell = string | number | null | undefined;
const str = (c: Cell) => (c == null ? "" : String(c)).trim();

const PREFIX_CLINIC: Record<string, ClinicId> = { SDCCP: "SDC1", SDCCM: "SDC2" };

export function payMode(info: string): PayMode {
  const s = info.toLowerCase();
  if (s === "cash") return "CASH";
  if (s.includes("upi")) return "UPI";
  if (s.includes("card")) return "CARD";
  return "OTHER";
}

/** Excel serial date, "2026-10-31" or "31/10/2026" -> "2026-10-31". */
function isoDate(c: Cell): string {
  if (typeof c === "number" && c > 20000 && c < 80000) {
    return new Date(Math.round((c - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = str(c);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}

function headerIndex(rows: Cell[][]) {
  return rows.findIndex((r) => r.some((c) => str(c) === "Patient Name") && r.some((c) => str(c) === "Amount Paid"));
}

export function isPappyJoePayments(rows: Cell[][]) {
  return headerIndex(rows) >= 0;
}

export function parsePappyJoe(rows: Cell[][], fileName = ""): ParsedPappyJoe {
  const errors: string[] = [];
  const warnings: string[] = [];
  const h = headerIndex(rows);
  if (h < 0) return { rows: [], errors: ["This does not look like a PappyJoe Payments export: no Patient Name / Amount Paid header."], warnings };
  const head = rows[h].map(str);
  const col = (name: string) => head.indexOf(name);
  const need = ["Date", "Patient Name", "Receipt No", "Amount Paid", "Payment Info"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) return { rows: [], errors: [`Missing column(s): ${missing.join(", ")}.`], warnings };

  const out: ParsedReceipt[] = [];
  const prefixes = new Map<string, number>();
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every((c) => !str(c))) continue;
    const date = isoDate(r[col("Date")]);
    if (!date) {
      errors.push(`Row ${i + 1}: could not read the date "${str(r[col("Date")])}".`);
      continue;
    }
    const rawName = str(r[col("Patient Name")]);
    const m = /^(.*?)\s*Patient id:-\s*(\S+)\s*$/i.exec(rawName);
    const patientName = (m ? m[1] : rawName).trim();
    const patientId = m ? m[2] : "";
    const pre = /^[A-Z]+/.exec(patientId)?.[0] ?? "";
    if (pre) prefixes.set(pre, (prefixes.get(pre) ?? 0) + 1);
    const amount = Number(str(r[col("Amount Paid")]).replace(/,/g, ""));
    if (!Number.isFinite(amount)) {
      errors.push(`Row ${i + 1}: Amount Paid is not a number.`);
      continue;
    }
    const paymentInfo = str(r[col("Payment Info")]);
    const receiptNo = str(r[col("Receipt No")]);
    if (!receiptNo) {
      errors.push(`Row ${i + 1}: no receipt number.`);
      continue;
    }
    out.push({
      date,
      patientName,
      patientId,
      receiptNo,
      invoiceNo: col("Invoice No") >= 0 ? str(r[col("Invoice No")]) : "",
      invoiceTotal: col("Invoice Total") >= 0 ? Number(str(r[col("Invoice Total")]).replace(/,/g, "")) || 0 : 0,
      amount,
      mode: payMode(paymentInfo),
      paymentInfo,
      receiptBy: col("Receipt By") >= 0 ? str(r[col("Receipt By")]) : "",
    });
  }

  // Which clinic: from the patient id prefix, else from the file name.
  let clinic: ClinicId | undefined;
  const known = [...prefixes.entries()].filter(([p]) => PREFIX_CLINIC[p]).sort((a, b) => b[1] - a[1]);
  if (known.length) {
    clinic = PREFIX_CLINIC[known[0][0]];
    if (known.length > 1) warnings.push("This file has patients from both clinics; it was filed under the clinic most of them belong to.");
  } else if (/podanur/i.test(fileName)) clinic = "SDC1";
  else if (/mlmpty|malumich/i.test(fileName)) clinic = "SDC2";
  if (!clinic) errors.push("Could not tell which clinic this file is for (patient ids are not SDCCP or SDCCM).");

  const other = out.filter((r) => r.mode === "OTHER");
  if (other.length) warnings.push(`${other.length} payment(s) have an unknown payment type (${[...new Set(other.map((o) => o.paymentInfo))].join(", ")}).`);
  const seen = new Set<string>();
  for (const r of out) {
    if (seen.has(r.receiptNo)) errors.push(`Receipt ${r.receiptNo} appears twice in the file.`);
    seen.add(r.receiptNo);
  }
  if (out.length === 0) errors.push("No payments found in the file.");
  return { clinic, rows: out, errors, warnings };
}
