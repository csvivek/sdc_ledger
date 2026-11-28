"use server";

import { requireAdmin } from "@/lib/auth";
import { getExtras } from "@/lib/data/extras";
import { checkBackupFile, type BackupCheck } from "@/lib/backup";

export type BackupCheckState = { result?: BackupCheck; error?: string; fileName?: string };

const MAX_BACKUP = 20 * 1024 * 1024;

/** Opens a backup file the admin picked and says whether it is complete. Reads only; never changes data. */
export async function checkBackup(_prev: BackupCheckState, formData: FormData): Promise<BackupCheckState> {
  await requireAdmin();
  const f = formData.get("file");
  if (!f || typeof f !== "object" || !("text" in f) || f.size === 0) return { error: "Pick a backup file first." };
  if (f.size > MAX_BACKUP) return { error: "That file is larger than 20 MB, so it is not an SDC Ledger backup.", fileName: f.name };
  try {
    const { counts } = await getExtras().countAll();
    return { result: checkBackupFile(await f.text(), counts), fileName: f.name };
  } catch (err) {
    console.error("checkBackup failed", err);
    return { error: "Could not check the file. Please try again.", fileName: f.name };
  }
}
