// Accountant's workbook download (admin only).

import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth";
import { getStore } from "@/lib/data/store";
import { getExtras } from "@/lib/data/extras";
import { accountantSheets, exportFileName } from "@/lib/accountant-export";
import { exportOptions } from "@/lib/export-params";
import { sheetToXlsx } from "@/lib/xlsx-sheet";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireAdmin();
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const extras = getExtras();
  const [d, gaps, counts] = await Promise.all([getStore().read(), extras.gapAnswers(), extras.pettyCounts()]);
  const { options, error } = exportOptions(d, sp);
  if (error) return new Response(error, { status: 400 });
  const sheets = accountantSheets(d, options, {
    gapAnswers: gaps.ready ? gaps.value : undefined,
    pettyCounts: counts.ready ? counts.value : undefined,
    madeBy: user.name,
  });
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, sheetToXlsx(s), s.name);
  const body = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }));
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${exportFileName(options)}"`,
      "Cache-Control": "no-store",
    },
  });
}
