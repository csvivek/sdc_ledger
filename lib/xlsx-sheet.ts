// Turns an export sheet into an Excel worksheet: dates become real dates
// (shown dd-mm-yyyy), amounts get thousands separators, columns get widths.

import * as XLSX from "xlsx";
import type { Sheet } from "./accountant-export";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function sheetToXlsx(s: Sheet): XLSX.WorkSheet {
  const rows = s.rows.map((r) => r.map((c) => (typeof c === "string" && DATE.test(c) ? new Date(`${c}T00:00:00Z`) : c)));
  const ws = XLSX.utils.aoa_to_sheet(rows, { cellDates: true, dateNF: "dd-mm-yyyy" });
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let R = range.s.r; R <= range.e.r; R++)
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (!cell) continue;
      if (cell.t === "n") cell.z = "#,##0.00";
      if (cell.t === "d") cell.z = "dd-mm-yyyy";
    }
  const start = s.header ?? 0;
  const widths = (s.rows[start] ?? []).map((_, c) =>
    Math.min(60, Math.max(8, ...s.rows.slice(start).map((r) => String(r[c] ?? "").length + 2))),
  );
  ws["!cols"] = widths.map((wch) => ({ wch }));
  return ws;
}
