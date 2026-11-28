import type { Metadata, Viewport } from "next";
import Image from "next/image";
import { Nav } from "@/components/Nav";
import { currentUser } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { logout } from "./actions";
import "./globals.css";

export const metadata: Metadata = {
  title: isSupabaseConfigured ? "SDC Ledger" : "SDC Ledger (prototype)",
  description: "Expense and income tracking for Sarada Dental Care.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0f6e7a" };


export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const isAdmin = user?.role === "admin" && user.active !== false;
  return (
    <html lang="en">
      <body className={isAdmin ? "admin" : undefined}>
        {!isSupabaseConfigured && (
          <div className="mock-banner">Prototype · all data is fake · not connected to PappyJoe, HDFC or Supabase</div>
        )}
        <header className="top">
          <strong className="brand">
            <span className="brand-logo">
              <Image src="/sdc-logo.png" alt="Sarada Dental Care" width={600} height={225} priority />
            </span>
            Ledger
          </strong>
          {user && (
            <form action={logout} className="who">
              <span className="who-name">{user.name}</span>
              <button type="submit" className="link">Log out</button>
            </form>
          )}
        </header>
        {isAdmin && <Nav />}
        <main>{children}</main>
      </body>
    </html>
  );
}
