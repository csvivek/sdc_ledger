import { promises as fs } from "fs";
import os from "os";
import path from "path";

export const ADMIN = { id: "admin_test", name: "Test Admin", role: "admin" as const };

/** Deletes the JSON store so the next read starts from the seed data. */
export async function resetStore() {
  await fs.rm(path.join(os.tmpdir(), "sdc-ledger"), { recursive: true, force: true });
}

export function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
