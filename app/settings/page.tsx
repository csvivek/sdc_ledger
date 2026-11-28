import Link from "next/link";
import { requireAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Tile = [href: string, title: string, what: string, danger?: boolean];

const GROUPS: [string, Tile[]][] = [
  [
    "Lists you set once",
    [
      ["/categories", "Categories", "Add, rename or hide expense categories"],
      ["/payees", "Payees", "Landlords, labs, consultants, suppliers"],
      ["/settings/bank-rules", "Bank rules", "How bank payments are sorted automatically"],
      ["/recurring", "Recurring expenses", "Rent, salaries, EB: the monthly list"],
    ],
  ],
  [
    "People",
    [
      ["/staff", "Staff logins", "Who can log in, and as what"],
      ["/activity", "Activity", "Who changed what, and when"],
    ],
  ],
  [
    "Data",
    [
      ["/backup", "Backup", "Download a full copy of the data"],
      ["/settings/delete-month", "Delete a month's import", "Remove a wrongly imported month", true],
    ],
  ],
];

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <>
      <h1>Settings</h1>
      {GROUPS.map(([heading, tiles]) => (
        <section key={heading}>
          <h2>{heading}</h2>
          <div className="setting-tiles">
            {tiles.map(([href, title, what, danger]) => (
              <Link key={href} href={href} className={danger ? "danger" : undefined}>
                <b>{title}</b>
                <span>{what}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
