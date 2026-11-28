// The admin menu: five areas grouped by job. Every page keeps its old address,
// so links and bookmarks still work; the menu only groups them.

export type AreaKey = "home" | "add" | "books" | "reports" | "settings";

export interface Area {
  key: AreaKey;
  label: string;
  /** Shorter label for the phone bottom bar. */
  short: string;
  href: string;
  /** Pages that belong to this area (the first segment of the path). */
  paths: string[];
  /** Sub-tabs shown under the menu, if any. */
  subs?: [string, string][];
}

export const BOOKS_STEPS: [string, string][] = [
  ["/import", "Import"],
  ["/reconciliation", "Reconcile"],
  ["/petty-cash", "Petty cash"],
  ["/card-income", "Card income"],
  ["/month-close", "Close"],
];

export const AREAS: Area[] = [
  { key: "home", label: "Home", short: "Home", href: "/dashboard", paths: ["/dashboard"] },
  { key: "add", label: "Add expense", short: "Add", href: "/expenses", paths: ["/expenses"] },
  { key: "books", label: "Books", short: "Books", href: "/reconciliation", paths: BOOKS_STEPS.map(([p]) => p) },
  {
    key: "reports",
    label: "Reports",
    short: "Reports",
    href: "/reports",
    paths: ["/reports", "/export"],
    subs: [
      ["/reports", "Reports"],
      ["/export", "Accountant export"],
    ],
  },
  {
    key: "settings",
    label: "Settings",
    short: "Settings",
    href: "/settings",
    paths: ["/settings", "/categories", "/payees", "/recurring", "/staff", "/activity", "/backup"],
  },
];

const under = (pathname: string, p: string) => pathname === p || pathname.startsWith(`${p}/`);

export function areaOf(pathname: string): Area | undefined {
  return AREAS.find((a) => a.paths.some((p) => under(pathname, p)));
}

/** The sub-tab that matches the path (longest match wins). */
export function activeSub(pathname: string, subs: [string, string][]): string | undefined {
  return subs
    .map(([p]) => p)
    .filter((p) => under(pathname, p))
    .sort((a, b) => b.length - a.length)[0];
}
