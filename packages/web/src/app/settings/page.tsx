export default function SettingsPage() {
  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted">
          Configure your AgentOps instance
        </p>
      </div>

      <div className="space-y-6">
        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Database
          </h2>
          <p className="text-xs text-muted mb-4">
            AgentOps uses a local SQLite database to store run data.
          </p>
          <div className="rounded bg-surface-2 p-3 font-mono text-xs text-muted">
            {process.env.AGENTOPS_DB_PATH ?? "~/.agentops/agentops.db"}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6">
          <h2 className="text-sm font-semibold text-foreground mb-1">
            Version
          </h2>
          <p className="text-xs text-muted">
            @agentops/web v0.1.0
          </p>
        </div>
      </div>
    </div>
  );
}
