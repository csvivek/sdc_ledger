import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDC Ledger (prototype)",
  description: "Expense and income tracking for Sarada Dental Care. Prototype with fake data.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

const ADMIN_NAV = [
  ["/dashboard", "Dashboard"],
  ["/expenses", "Add expense"],
  ["/petty-cash", "Petty cash"],
  ["/reconciliation", "Reconcile"],
  ["/card-income", "Card income"],
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <div className="mock-banner">Prototype · all data is fake · not connected to PappyJoe, HDFC or Supabase</div>
        <header className="top">
          <strong>SDC Ledger</strong>
          {user && (
            <form action={logout} className="who">
              <span>{user.name}</span>
              <button type="submit" className="link">Log out</button>
            </form>
          )}
        </header>
        {user?.role === "admin" && (
          <nav className="nav">
            {ADMIN_NAV.map(([href, label]) => (
              <Link key={href} href={href}>
                {label}
              </Link>
            ))}
          </nav>
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
