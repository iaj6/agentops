import type { Metadata } from "next";
import { listEvents } from "@agentops/db";
import { db } from "@/lib/db";
import { EventLog } from "./EventLog";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Events",
};

export default async function EventsPage() {
  const initialEvents = listEvents(db(), { limit: 100 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Events</h1>
        <p className="text-sm text-muted">Real-time event stream across all systems</p>
      </div>
      <EventLog initialEvents={JSON.parse(JSON.stringify(initialEvents))} />
    </div>
  );
}
