import { Suspense } from "react";
import { redirect } from "next/navigation";
import { listRunsWithSummaries, listUsers } from "@agentops/db";
import { db } from "@/lib/db";
import { getRequestUser, resolveViewScope } from "@/lib/auth";
import { RunsTable } from "./RunsTable";
import { FleetOverview } from "./FleetOverview";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; userId?: string }>;
}) {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/");

  const params = await searchParams;
  const scope = resolveViewScope(user, params);

  const runsWithSummaries = listRunsWithSummaries(db(), {
    limit: 50,
    ...(scope.userId ? { userId: scope.userId } : {}),
  });

  // Resolve userId → email/name once per page render. Pass a thin
  // {id,email,name}[] down so client components can chip-render
  // each run without an N+1 fetch loop.
  const users = listUsers(db()).map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
  }));

  // Page chrome label: "Sarah's runs" when an admin drilled into one
  // user, "Your runs" when scoped to self, "Fleet overview" when team-wide.
  let subtitle: string;
  if (scope.active === "user" && scope.userId) {
    const target = users.find((u) => u.id === scope.userId);
    subtitle = target ? `${target.name ?? target.email}'s runs` : "Filtered runs";
  } else if (scope.active === "mine") {
    subtitle = "Your runs";
  } else {
    subtitle = "Fleet overview — every user's runs";
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      <FleetOverview>
        {runsWithSummaries.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
            <div className="text-4xl text-muted mb-3">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect x="6" y="6" width="36" height="36" rx="4" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
                <path d="M18 24h12M24 18v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">
              {scope.active === "mine"
                ? "You have no runs yet"
                : "No runs yet"}
            </p>
            <p className="text-xs text-muted mt-1">
              Start an agent run using the CLI to see it here.
            </p>
          </div>
        ) : (
          <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading runs...</div>}>
            <RunsTable
              runs={JSON.parse(JSON.stringify(runsWithSummaries))}
              users={users}
              currentUser={{ id: user.id, role: user.role }}
            />
          </Suspense>
        )}
      </FleetOverview>
    </div>
  );
}
