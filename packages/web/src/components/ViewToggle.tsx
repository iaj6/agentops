"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// View toggle in the sidebar. Visible only to admins (members can't see
// other people's data anyway, so the choice would be moot). Pushes
// ?view=mine|team onto the current pathname so SSR pages can scope.
export function ViewToggle({ canToggle }: { canToggle: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (!canToggle) return null;

  const current = searchParams.get("view") === "mine" ? "mine" : "team";

  function setView(view: "mine" | "team") {
    if (view === current) return;
    const next = new URLSearchParams(searchParams.toString());
    if (view === "team") next.delete("view"); // team is the admin default
    else next.set("view", "mine");
    const qs = next.toString();
    router.push(`${pathname}${qs ? `?${qs}` : ""}`);
  }

  return (
    <div className="hidden md:block">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted">View</p>
      <div className="flex rounded-md border border-border bg-surface-2 p-0.5">
        <button
          type="button"
          onClick={() => setView("team")}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            current === "team"
              ? "bg-accent/15 text-accent"
              : "text-muted hover:text-foreground"
          }`}
          aria-pressed={current === "team"}
        >
          Team
        </button>
        <button
          type="button"
          onClick={() => setView("mine")}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            current === "mine"
              ? "bg-accent/15 text-accent"
              : "text-muted hover:text-foreground"
          }`}
          aria-pressed={current === "mine"}
        >
          Mine
        </button>
      </div>
    </div>
  );
}
