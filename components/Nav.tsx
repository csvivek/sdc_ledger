"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AREAS, activeSub, areaOf, type AreaKey } from "@/lib/nav";

const ICONS: Record<AreaKey, React.ReactNode> = {
  home: <path d="M3 11l9-7 9 7M5 10v10h14V10" />,
  add: <path d="M12 6v12M6 12h12" />,
  books: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4" />
    </>
  ),
  reports: <path d="M5 20V11M12 20V5M19 20v-7" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </>
  ),
};

function Icon({ k }: { k: AreaKey }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[k]}
    </svg>
  );
}

/**
 * Admin menu: five areas. On wide screens they sit as tabs at the top; on phones
 * as a bar fixed to the bottom of the screen, in thumb reach. Areas with
 * sub-pages show them as a row of chips under the menu.
 */
export function Nav() {
  const pathname = usePathname();
  const area = areaOf(pathname);
  const sub = area?.subs ? activeSub(pathname, area.subs) : undefined;
  const inSettingsPage = area?.key === "settings" && pathname !== "/settings";

  return (
    <>
      <nav className="nav" aria-label="Main menu">
        <div className="nav-links">
          {AREAS.map((a) => {
            const on = area?.key === a.key;
            return (
              <Link key={a.key} href={a.href} className={`${on ? "active" : ""} area-${a.key}`} aria-current={on ? "page" : undefined}>
                <Icon k={a.key} />
                <span className="nav-label">{a.label}</span>
                <span className="nav-short">{a.short}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      {area?.subs && (
        <nav className="subnav" aria-label={`${area.label} pages`}>
          {area.subs.map(([href, label]) => (
            <Link key={href} href={href} className={sub === href ? "active" : ""} aria-current={sub === href ? "page" : undefined}>
              {label}
            </Link>
          ))}
        </nav>
      )}
      {inSettingsPage && (
        <nav className="subnav back" aria-label="Settings">
          <Link href="/settings">‹ Settings</Link>
        </nav>
      )}
    </>
  );
}
