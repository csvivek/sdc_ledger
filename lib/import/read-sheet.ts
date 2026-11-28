// Turns an uploaded spreadsheet into rows of cells. Server only.
import * as XLSX from "xlsx";

export type Cell = string | number | null;

/** The first sheet as rows of cells, and how many sheets the workbook has. */
export function readWorkbook(buf: Buffer | Uint8Array): { rows: Cell[][]; sheetCount: number } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, cellFormula: false, cellHTML: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return { rows: [], sheetCount: 0 };
  return { rows: XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: "", blankrows: true }), sheetCount: wb.SheetNames.length };
}

export function readSheetRows(buf: Buffer | Uint8Array): Cell[][] {
  return readWorkbook(buf).rows;
}
