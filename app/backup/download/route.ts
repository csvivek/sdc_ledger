// Full data backup download (admin only): every table as one JSON file, or the
// same data as an Excel workbook with one sheet per table.

import * as XLSX from "xlsx";
import { requireAdmin } from "@/lib/auth";
import { getExtras } from "@/lib/data/extras";
import { backupFileName, backupSheets, buildBackupFile, countsOf, totalRows, type BackupFormat } from "@/lib/backup";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireAdmin();
  const format: BackupFormat = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "json";
  const extras = getExtras();
  const dump = await extras.dumpAll();
  const counts = countsOf(dump);
  const name = backupFileName(format);

  let body: Uint8Array | string;
  let type: string;
  if (format === "json") {
    body = JSON.stringify(buildBackupFile(dump, user.name));
    type = "application/json";
  } else {
    const wb = XLSX.utils.book_new();
    for (const s of backupSheets(dump)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
    body = new Uint8Array(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
    type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }

  try {
    await extras.logBackup({ takenBy: user.id, format, totalRows: totalRows(counts), counts });
  } catch (err) {
    // The file is still worth having even if remembering it failed.
    console.error("backup: could not record the download", err);
  }

  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
