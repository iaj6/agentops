import { listLocks } from "@agentops/db";
import { db } from "@/lib/db";
import { CoordinationView } from "./CoordinationView";

export const dynamic = "force-dynamic";

export default function CoordinationPage() {
  const locks = listLocks(db(), { limit: 100 });

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Coordination</h1>
        <p className="text-sm text-muted">
          {locks.length} lock{locks.length !== 1 ? "s" : ""}
        </p>
      </div>
      {locks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-surface py-20">
          <p className="text-sm font-medium text-foreground">No locks</p>
          <p className="text-xs text-muted mt-1">
            Resource locks will appear here when agents acquire them.
          </p>
        </div>
      ) : (
        <CoordinationView locks={JSON.parse(JSON.stringify(locks))} />
      )}
    </div>
  );
}
