// MOCK DATA. Every name, amount and date here is invented for the prototype.
// Nothing comes from the real workbook, PappyJoe or HDFC.

import type {
  BankDeposit,
  CardPayment,
  ClinicId,
  Expense,
  LedgerData,
  PappyJoeMonth,
  PettyCashTransfer,
} from "../types";

export const SEED_MONTHS = ["2026-09", "2026-10", "2026-11"];

const CATEGORIES = [
  "Salary",
  "Rent",
  "EB (electricity)",
  "Flowers",
  "Lab",
  "Pharma",
  "Consultant",
  "Dental materials",
  "Marketing",
  "Bank charges",
  "Miscellaneous",
];

let n = 0;
const id = (p: string) => `${p}_${++n}`;

function buildExpenses(): Expense[] {
  const out: Expense[] = [];
  const add = (
    date: string,
    amount: number,
    category: string,
    clinic: Expense["clinic"],
    paidBy: Expense["paidBy"],
    note: string,
    enteredBy = "admin",
    pettyCashClinic?: ClinicId,
  ) =>
    out.push({
      id: id("exp"),
      date,
      amount,
      category,
      clinic,
      paidBy,
      pettyCashClinic: paidBy === "PETTY_CASH" ? (pettyCashClinic ?? (clinic === "SHARED" ? "SDC1" : clinic)) : undefined,
      note,
      enteredBy,
      enteredAt: `${date}T10:00:00.000Z`,
    });

  SEED_MONTHS.forEach((m, i) => {
    const bump = i * 1500;
    // Bank-paid fixed costs
    add(`${m}-01`, 45000, "Rent", "SDC1", "BANK", "Podanur clinic rent");
    add(`${m}-01`, 38000, "Rent", "SDC2", "BANK", "Malumichampatti clinic rent");
    add(`${m}-05`, 62000, "Salary", "SDC1", "BANK", "Staff salaries");
    add(`${m}-05`, 54000, "Salary", "SDC2", "BANK", "Staff salaries");
    add(`${m}-08`, 6200 + bump, "EB (electricity)", "SDC1", "BANK", "TNEB bill");
    add(`${m}-08`, 5100 + bump / 2, "EB (electricity)", "SDC2", "BANK", "TNEB bill");
    add(`${m}-12`, 28000 + i * 4000, "Consultant", "SDC1", "BANK", "Ortho consultant visits");
    add(`${m}-14`, 18000, "Consultant", "SDC2", "BANK", "Endo consultant visits");
    add(`${m}-15`, 21500 + bump, "Lab", "SDC1", "UPI", "Crown and bridge lab");
    add(`${m}-16`, 14800, "Lab", "SDC2", "UPI", "Denture lab");
    add(`${m}-18`, 16500, "Dental materials", "SHARED", "BANK", "Monthly materials order");
    add(`${m}-20`, 7400, "Pharma", "SHARED", "UPI", "Medicines stock");
    add(`${m}-22`, 5000, "Marketing", "SHARED", "UPI", "Social media ads");
    add(`${m}-28`, 590, "Bank charges", "SHARED", "BANK", "HDFC charges");
    // Petty cash spends (entered by staff)
    for (const d of ["03", "10", "17", "24"]) {
      add(`${m}-${d}`, 350, "Flowers", "SDC1", "PETTY_CASH", "Pooja flowers", "staff1");
      add(`${m}-${d}`, 300, "Flowers", "SDC2", "PETTY_CASH", "Pooja flowers", "staff2");
    }
    add(`${m}-09`, 1200, "Miscellaneous", "SDC1", "PETTY_CASH", "Water cans and cleaning", "staff1");
    add(`${m}-11`, 950, "Miscellaneous", "SDC2", "PETTY_CASH", "Water cans", "staff2");
    add(`${m}-19`, 2300, "Pharma", "SDC1", "PETTY_CASH", "Local pharmacy top-up", "staff1");
  });
  return out;
}

function buildTransfers(): PettyCashTransfer[] {
  return SEED_MONTHS.flatMap((m) => [
    { id: id("pct"), date: `${m}-02`, clinic: "SDC1" as const, amount: 5000, note: "Doctor's monthly withdrawal for SDC 1" },
    { id: id("pct"), date: `${m}-02`, clinic: "SDC2" as const, amount: 4000, note: "Doctor's monthly withdrawal for SDC 2" },
  ]);
}

const PJ: Array<[string, ClinicId, number, number, number]> = [
  // month, clinic, cash, upi, card
  ["2026-09", "SDC1", 182000, 241000, 64000],
  ["2026-09", "SDC2", 121000, 158000, 38000],
  ["2026-10", "SDC1", 196500, 262000, 71000],
  ["2026-10", "SDC2", 128000, 171500, 42500],
  ["2026-11", "SDC1", 174000, 255000, 58000],
  ["2026-11", "SDC2", 117500, 166000, 35000],
];

function buildPappyJoe(): PappyJoeMonth[] {
  return PJ.map(([month, clinic, cash, upi, card]) => ({ month, clinic, cash, upi, card }));
}

function buildBankDeposits(): BankDeposit[] {
  // Cash goes in as several lumps a month. Some months fall short of PappyJoe on purpose,
  // so the reconciliation screen has gaps to explain.
  const shortfall: Record<string, number> = {
    "2026-09|SDC1": 0,
    "2026-09|SDC2": 0,
    "2026-10|SDC1": 6500,
    "2026-10|SDC2": 0,
    "2026-11|SDC1": 22000,
    "2026-11|SDC2": 9500,
  };
  const out: BankDeposit[] = [];
  for (const [month, clinic, cash, upi] of PJ) {
    const short = shortfall[`${month}|${clinic}`] ?? 0;
    const cashIn = cash - short;
    const lumps = [0.35, 0.3, 0.35];
    let left = cashIn;
    lumps.forEach((f, i) => {
      const amt = i === lumps.length - 1 ? left : Math.round((cashIn * f) / 100) * 100;
      left -= amt;
      out.push({
        id: id("dep"),
        date: `${month}-${["09", "18", "27"][i]}`,
        clinic,
        kind: "CASH",
        amount: amt,
        narration: `CASH DEPOSIT ${clinic === "SDC1" ? "PODANUR" : "MALUMICHAMPATTI"}`,
      });
    });
    out.push({
      id: id("dep"),
      date: `${month}-28`,
      clinic,
      kind: "UPI",
      amount: upi - (month === "2026-11" && clinic === "SDC2" ? 1200 : 0),
      narration: "UPI SETTLEMENT",
    });
  }
  return out;
}

function buildCardPayments(): CardPayment[] {
  const out: CardPayment[] = [];
  const rows: Array<[string, ClinicId, string, number, string | undefined]> = [
    ["2026-10-06", "SDC1", "PT-1043", 18000, "2026-10-29"],
    ["2026-10-14", "SDC2", "PT-2211", 12500, "2026-10-30"],
    ["2026-10-23", "SDC1", "PT-1077", 9000, undefined],
    ["2026-11-03", "SDC1", "PT-1102", 22000, "2026-11-20"],
    ["2026-11-07", "SDC2", "PT-2240", 8500, undefined],
    ["2026-11-12", "SDC1", "PT-1118", 15000, undefined],
    ["2026-11-19", "SDC2", "PT-2262", 14000, undefined],
    ["2026-11-21", "SDC1", "PT-1131", 11000, undefined],
  ];
  for (const [date, clinic, patientRef, amount, creditedOn] of rows) {
    out.push({ id: id("card"), date, clinic, patientRef, amount, creditedOn });
  }
  return out;
}

export function buildSeed(): LedgerData {
  n = 0;
  return {
    users: [
      { id: "admin", name: "Doctor (Admin)", role: "admin" },
      { id: "staff1", name: "Front desk, SDC 1", role: "staff", clinic: "SDC1" },
      { id: "staff2", name: "Front desk, SDC 2", role: "staff", clinic: "SDC2" },
    ],
    categories: CATEGORIES,
    categoryPayeeKind: { Salary: "staff", Lab: "lab", Pharma: "pharma", "Dental materials": "supplier", Consultant: "consultant" },
    invoiceCategories: ["Lab", "Pharma", "Dental materials"],
    // Invented names, for the fake-data prototype only.
    payees: [
      { id: "payee_staff_1", kind: "staff", name: "Demo Assistant A", active: true },
      { id: "payee_staff_2", kind: "staff", name: "Demo Assistant B", active: true },
      { id: "payee_lab_1", kind: "lab", name: "Demo Dental Lab", active: true },
      { id: "payee_pharma_1", kind: "pharma", name: "Demo Pharmacy", active: true },
      { id: "payee_supplier_1", kind: "supplier", name: "Demo Dental Supply", active: true },
      { id: "payee_cons_1", kind: "consultant", name: "Demo Consultant", active: true },
    ],
    expenses: buildExpenses(),
    pettyCashTransfers: buildTransfers(),
    pettyCashOpening: { SDC1: 1500, SDC2: 1000 },
    pappyJoe: buildPappyJoe(),
    bankDeposits: buildBankDeposits(),
    reconReasons: [
      {
        month: "2026-10",
        clinic: "SDC1",
        reason: "Cash paid to lab technician directly from the counter (to confirm with receipt).",
        updatedAt: "2026-11-02T09:00:00.000Z",
      },
    ],
    cardPayments: buildCardPayments(),
  };
}
