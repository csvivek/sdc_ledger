import { beforeEach, describe, expect, it } from "vitest";
import { activeSub, AREAS, areaOf } from "@/lib/nav";
import { booksSteps } from "@/lib/books";
import { monthsIn, pettyCashMonth } from "@/lib/calc";
import { getStore } from "@/lib/data/store";
import { getExtras } from "@/lib/data/extras";
import { staffPettyMonth } from "@/lib/staff-petty";
import { CLINICS } from "@/lib/types";
import { resetStore } from "./helpers";

describe("menu areas", () => {
  it("keeps every old page address in exactly one area", () => {
    const old = ["/dashboard", "/expenses", "/petty-cash", "/import", "/reconciliation", "/card-income", "/payees", "/categories", "/recurring", "/month-close", "/export", "/staff", "/activity", "/backup"];
    for (const p of old) expect(AREAS.filter((a) => a.paths.some((x) => p === x)).length, p).toBe(1);
  });

  it("finds the area for sub-paths and new pages", () => {
    expect(areaOf("/settings/bank-rules")?.key).toBe("settings");
    expect(areaOf("/export/print")?.key).toBe("reports");
    expect(areaOf("/import/file/123")?.key).toBe("books");
    expect(areaOf("/login")).toBeUndefined();
    expect(areaOf("/reportsx")).toBeUndefined();
  });

  it("picks the longest matching sub-tab", () => {
    const subs = AREAS.find((a) => a.key === "reports")!.subs!;
    expect(activeSub("/export/print", subs)).toBe("/export");
    expect(activeSub("/reports", subs)).toBe("/reports");
  });
});

describe("books steps", () => {
  beforeEach(resetStore);

  it("has the five steps in order, Close not done until the month is closed", async () => {
    const d = await getStore().read();
    const month = monthsIn(d)[0];
    const steps = booksSteps(d, month, {}, false);
    expect(steps.map((s) => s.label)).toEqual(["Import", "Reconcile", "Petty cash", "Card income", "Close"]);
    expect(steps[4].state).toBe("todo");
    expect(booksSteps(d, month, {}, true)[4].state).toBe("done");
  });

  it("marks a step not done with what is left", async () => {
    const d = await getStore().read();
    const month = monthsIn(d)[0];
    const petty = booksSteps(d, month, { gapAnswers: [], pettyCounts: [] }, false)[2];
    expect(petty.state).toBe("todo");
    expect(petty.hint).toBe("not counted");
    const counted = booksSteps(
      d,
      month,
      { gapAnswers: [], pettyCounts: CLINICS.map((c) => ({ clinic: c, month, counted: 0, note: "" })) },
      false,
    )[2];
    expect(counted.state).toBe("done");
  });
});

describe("staff petty cash", () => {
  beforeEach(resetStore);

  it("matches the admin's petty cash page for the same clinic and month", async () => {
    const d = await getStore().read();
    const staff = d.users.find((u) => u.role === "staff" && (u.clinic === "SDC1" || u.clinic === "SDC2"))!;
    const mine = await getExtras().myPettyCash(staff.id);
    expect(mine.ready).toBe(true);
    if (!mine.ready || !mine.value) throw new Error("no figures");
    expect(mine.value.clinic).toBe(staff.clinic);
    for (const m of monthsIn(d)) {
      const admin = pettyCashMonth(d, staff.clinic!, m);
      const own = staffPettyMonth(mine.value, m);
      expect([own.carriedIn, own.received, own.spent, own.expected], m).toEqual([admin.carriedIn, admin.received, admin.spent, admin.expected]);
    }
  });

  it("gives nothing for a login with no clinic", async () => {
    const mine = await getExtras().myPettyCash("nobody");
    expect(mine).toEqual({ ready: true, value: undefined });
  });
});

describe("money format", () => {
  it("puts the minus sign before the rupee symbol", async () => {
    const { inr } = await import("@/lib/calc");
    expect(inr(-3554)).toBe("-₹3,554");
    expect(inr(123456)).toBe("₹1,23,456");
    expect(inr(-0.4)).toBe("₹0");
  });
});
