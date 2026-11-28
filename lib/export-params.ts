// Reads the accountant export's choices from the address (?from=&to=&clinic=).

import { monthsIn } from "./calc";
import { validateRange, type ExportOptions, type Scope } from "./accountant-export";
import type { LedgerData } from "./types";

export function parseScope(v: string | undefined): Scope {
  return v === "SDC1" || v === "SDC2" ? v : "ALL";
}

/** The chosen range, or the latest month with data when nothing (or something invalid) was chosen. */
export function exportOptions(d: LedgerData, sp: { from?: string; to?: string; clinic?: string }): { options: ExportOptions; error?: string } {
  const months = monthsIn(d);
  const latest = months[months.length - 1];
  const scope = parseScope(sp.clinic);
  if (!sp.from && !sp.to) return { options: { from: latest, to: latest, scope } };
  const v = validateRange(sp.from, sp.to ?? sp.from);
  if (!v.ok) return { options: { from: latest, to: latest, scope }, error: v.error };
  return { options: { from: v.from, to: v.to, scope } };
}
