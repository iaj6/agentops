"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "Runs", icon: RunsIcon },
  { href: "/analytics", label: "Analytics", icon: AnalyticsIcon },
  { href: "/policies", label: "Policies", icon: PoliciesIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-14 md:w-56 flex-col border-r border-border bg-surface transition-all duration-200">
      <div className="flex h-14 items-center gap-2 border-b border-border px-3 md:px-4">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="shrink-0">
          <rect x="2" y="2" width="9" height="9" rx="2" fill="var(--accent)" opacity="0.9" />
          <rect x="13" y="2" width="9" height="9" rx="2" fill="var(--accent)" opacity="0.6" />
          <rect x="2" y="13" width="9" height="9" rx="2" fill="var(--accent)" opacity="0.6" />
          <rect x="13" y="13" width="9" height="9" rx="2" fill="var(--accent)" opacity="0.3" />
        </svg>
        <span className="hidden md:inline text-sm font-semibold tracking-tight text-foreground">
          AgentOps
        </span>
      </div>
      <nav className="flex-1 space-y-0.5 px-1.5 md:px-2 py-3">
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/" || pathname.startsWith("/runs")
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={item.label}
              className={`flex items-center justify-center md:justify-start gap-2.5 rounded-md px-2.5 md:px-3 py-2 text-sm transition-colors ${
                isActive
                  ? "bg-accent/10 text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              }`}
            >
              <item.icon active={isActive} />
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border px-3 md:px-4 py-3">
        <p className="hidden md:block text-xs text-muted">v0.1.0</p>
      </div>
    </aside>
  );
}

function RunsIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={active ? "text-accent" : "text-muted"}
    >
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function AnalyticsIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={active ? "text-accent" : "text-muted"}
    >
      <rect x="2" y="8" width="3" height="6" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="6.5" y="5" width="3" height="9" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="2" width="3" height="12" rx="0.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function PoliciesIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={active ? "text-accent" : "text-muted"}
    >
      <path
        d="M8 1.5L2.5 4v4c0 3.5 2.5 5.5 5.5 7 3-1.5 5.5-3.5 5.5-7V4L8 1.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SettingsIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      className={active ? "text-accent" : "text-muted"}
    >
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
