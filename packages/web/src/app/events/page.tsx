import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listEvents } from "@agentops/db";
import { db } from "@/lib/db";
import { getRequestUser, resolveViewScope } from "@/lib/auth";
import { resolveOwnedSourceIds } from "@/lib/event-scope";
import { EventLog } from "./EventLog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; userId?: string }>;
}) {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/events");

  const params = await searchParams;
  const scope = resolveViewScope(user, params);
  const sourceIds = resolveOwnedSourceIds(scope.userId);

  const initialEvents = listEvents(db(), {
    limit: 100,
    ...(sourceIds ? { sourceIds } : {}),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Events</h1>
        <p className="text-sm text-muted">
          {scope.active === "mine"
            ? "Your event stream"
            : scope.active === "user"
              ? "Filtered event stream"
              : "Real-time event stream across all systems"}
        </p>
      </div>
      <EventLog initialEvents={JSON.parse(JSON.stringify(initialEvents))} />
    </div>
  );
}
