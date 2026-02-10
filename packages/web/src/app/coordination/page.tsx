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
          Resource lock management and conflict detection
        </p>
      </div>
      <CoordinationView locks={JSON.parse(JSON.stringify(locks))} />
    </div>
  );
}
