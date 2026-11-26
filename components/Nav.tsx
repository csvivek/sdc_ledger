"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Admin menu: a row of tabs on wide screens, a collapsible list behind a Menu button on phones. */
export function Nav({ items }: { items: [string, string][] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the phone menu after moving to another page.
  useEffect(() => setOpen(false), [pathname]);

  const current = items.find(([href]) => pathname === href || pathname.startsWith(`${href}/`));

  return (
    <nav className={`nav ${open ? "open" : ""}`} aria-label="Main menu">
      <button
        type="button"
        className="nav-toggle"
        aria-expanded={open}
        aria-controls="nav-links"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="nav-toggle-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{current ? current[1] : "Menu"}</span>
        <svg className="nav-toggle-caret" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id="nav-links" className="nav-links">
        {items.map(([href, label]) => {
          const active = current?.[0] === href;
          return (
            <Link key={href} href={href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
