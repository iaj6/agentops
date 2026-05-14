import { Suspense } from "react";
import { redirect } from "next/navigation";
import { listSessions } from "@agentops/db";
import { db } from "@/lib/db";
import { getRequestUser, resolveViewScope } from "@/lib/auth";
import { SessionsTable } from "./SessionsTable";

export const dynamic = "force-dynamic";

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/sessions");

  const params = await searchParams;
  const scope = resolveViewScope(user, params);

  const sessions = listSessions(db(), {
    limit: 50,
    ...(scope.userId ? { userId: scope.userId } : {}),
  });

  const total = sessions.length;
  const active = sessions.filter((s) => s.status === "active").length;
  const terminated = sessions.filter((s) => s.status === "terminated").length;

  const scopeLabel = scope.active === "mine" ? "your" : "team";

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Sessions</h1>
          <p className="text-sm text-muted">
            {total} {scopeLabel} session{total !== 1 ? "s" : ""} &mdash; {active} active, {terminated} terminated
          </p>
        </div>
      </div>
      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <p className="text-sm font-medium text-foreground">
            {scope.active === "mine" ? "You have no sessions yet" : "No sessions yet"}
          </p>
          <p className="text-xs text-muted mt-1">
            Sessions will appear here when agents are provisioned.
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="py-8 text-center text-sm text-muted">Loading sessions...</div>}>
          <SessionsTable sessions={JSON.parse(JSON.stringify(sessions))} />
        </Suspense>
      )}
    </div>
  );
}
