import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { PAYEE_KINDS, PAYEE_KIND_LABEL } from "@/lib/types";

describe("landlord payee type", () => {
  it("is offered with a label", () => {
    expect(PAYEE_KINDS).toContain("landlord");
    expect(PAYEE_KIND_LABEL.landlord).toBe("Landlord / other vendor");
  });

  it("is added to the database enum without touching existing values", () => {
    const sql = readFileSync("supabase/migrations/20261127000000_landlord_payees.sql", "utf8");
    expect(sql).toMatch(/alter type public\.payee_kind add value if not exists 'landlord'/);
    expect(sql).not.toMatch(/drop|delete|update/i);
  });
});
