// Made-up import files for the tests, built in memory. Names, amounts and
// accounts are invented; no real statement or patient data is used.
import * as XLSX from "xlsx";

type Cell = string | number;

export interface FakeTxn {
  date: string; // dd/mm/yy as HDFC prints it
  narration: string;
  ref: string;
  out?: number;
  in?: number;
}

function book(rows: Cell[][], bookType: XLSX.BookType): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet 1");
  return new Uint8Array(XLSX.write(wb, { bookType, type: "buffer" }) as Buffer);
}

export interface HdfcOptions {
  opening?: number;
  from?: string;
  to?: string;
  /** Change the summary so it no longer matches the rows. */
  badTotals?: boolean;
  noSummary?: boolean;
  noBankName?: boolean;
  header?: Cell[];
  /** Replace one cell of a transaction row: [rowIndex, column, value]. */
  poke?: [number, number, Cell];
}

export const HDFC_HEADER: Cell[] = ["Date", "Narration", "Chq./Ref.No.", "Value Dt", "Withdrawal Amt.", "Deposit Amt.", "Closing Balance"];

/** An HDFC account statement laid out like the net banking download (.xls). */
export function hdfcFile(txns: FakeTxn[], o: HdfcOptions = {}): Uint8Array {
  const opening = o.opening ?? 100000;
  let bal = opening;
  const body: Cell[][] = txns.map((t) => {
    bal = Math.round((bal - (t.out ?? 0) + (t.in ?? 0)) * 100) / 100;
    return [t.date, t.narration, t.ref, t.date, t.out ?? "", t.in ?? "", bal];
  });
  if (o.poke) body[o.poke[0]][o.poke[1]] = o.poke[2];
  const debits = txns.reduce((a, t) => a + (t.out ?? 0), 0);
  const credits = txns.reduce((a, t) => a + (t.in ?? 0), 0);
  const rows: Cell[][] = [
    [o.noBankName ? "SOME BANK Ltd.          Statement of accounts" : "HDFC BANK Ltd.          Page No .:   1          Statement of accounts"],
    ["M/S.    TEST DENTAL CLINIC"],
    [`Statement From  :  ${o.from ?? txns[0]?.date ?? ""}         To  :  ${o.to ?? txns[txns.length - 1]?.date ?? ""}`],
    [""],
    o.header ?? HDFC_HEADER,
    ["**********", "**********", "**********", "**********", "**********", "**********", "**********"],
    ...body,
    ["**********"],
  ];
  if (!o.noSummary)
    rows.push(
      ["STATEMENT SUMMARY  :-"],
      [""],
      ["Opening Balance", "", "", "", "Debits", "Credits", "Closing Bal"],
      [opening, "", "", "", o.badTotals ? debits + 100 : debits, credits, bal],
      [""],
      ["", "", "", "", "Dr Count", "Cr Count", ""],
      ["", "", "", "", txns.filter((t) => t.out).length, txns.filter((t) => t.in).length, ""],
    );
  rows.push([o.noBankName ? "Registered office" : "HDFC Bank GSTIN number"], ["---  End Of Statement ---"]);
  return book(rows, "biff8");
}

/** Bank rows for a run of days: a UPI receipt and a petty-cash style debit on each day. */
export function bankDays(fromDay: number, toDay: number, month = "10"): FakeTxn[] {
  const out: FakeTxn[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    const dd = String(d).padStart(2, "0");
    out.push({ date: `${dd}/${month}/26`, narration: `UPI-TEST PATIENT ${dd}-ok@bank-REF${month}${dd}-PAY`, ref: `R${month}${dd}A`, in: 500 + d });
    out.push({ date: `${dd}/${month}/26`, narration: `UPI-NEW SUPPLIER-supplier@bank-REF${month}${dd}B-ITEMS`, ref: `R${month}${dd}B`, out: 200 + d });
  }
  return out;
}

export const PJ_HEADER: Cell[] = [
  "Date",
  "Patient Name",
  "Receipt No",
  "Invoice No",
  "Invoice Total",
  "Amount Paid",
  "Payment Info",
  "Receipt From",
  "Account Type",
  "Details",
  "Receipt By",
];

export interface FakeReceipt {
  date: string; // YYYY-MM-DD
  receipt: string;
  amount: number | string;
  mode?: string;
  prefix?: string;
}

/** A PappyJoe Payments export (.xlsx). Patient ids start SDCCP (Podanur) unless prefix says otherwise. */
export function pappyJoeFile(receipts: FakeReceipt[], header: Cell[] = PJ_HEADER): Uint8Array {
  const rows: Cell[][] = [
    header,
    ...receipts.map((r, i) => {
      const full: Record<string, Cell> = {
        Date: r.date,
        "Patient Name": `TEST PATIENT ${i}Patient id:- ${r.prefix ?? "SDCCP"}${1000 + i}`,
        "Receipt No": r.receipt,
        "Invoice No": `INV${i}`,
        "Invoice Total": typeof r.amount === "number" ? Math.abs(r.amount) : 0,
        "Amount Paid": r.amount,
        "Payment Info": r.mode ?? "cash",
        "Receipt From": "",
        "Account Type": "",
        Details: "",
        "Receipt By": "Front desk",
      };
      return header.map((h) => full[String(h)] ?? "");
    }),
  ];
  return book(rows, "xlsx");
}

/** Any other spreadsheet, for files that must be turned away. */
export function otherSheet(rows: Cell[][], bookType: XLSX.BookType = "xlsx"): Uint8Array {
  return book(rows, bookType);
}

export function asFile(data: Uint8Array, name: string): File {
  return new File([data as BlobPart], name);
}
