// Turns an uploaded spreadsheet into rows of cells. Server only.
import * as XLSX from "xlsx";

export type Cell = string | number | null;

export function readSheetRows(buf: Buffer | Uint8Array): Cell[][] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellFormula: false, cellHTML: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: "", blankrows: true });
}
