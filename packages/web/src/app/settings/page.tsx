import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { AdminApiStatus } from "./AdminApiStatus";
import { ApiTokensSection } from "./ApiTokensSection";

export const metadata: Metadata = {
  title: "Settings",
  description: "Your account, integrations, and system info",
};

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/settings");
  const role = user.role === "admin" ? "admin" : "member";

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted">
          {role === "admin"
            ? "Your account, integrations, and system info. Team management lives in Admin Console."
            : "Your account, integrations, and system info."}
        </p>
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Profile
          </h2>
          <div className="rounded-lg border border-border bg-surface p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted">Name</p>
                <p className="text-foreground">{user.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Email</p>
                <p className="text-foreground font-mono">{user.email}</p>
              </div>
              <div>
                <p className="text-xs text-muted">Role</p>
                <p className="text-foreground capitalize">{role}</p>
              </div>
            </div>
            <p className="mt-4 text-xs text-muted">
              Need to change your password?{" "}
              <a href="/change-password" className="text-accent hover:underline">
                Update it here
              </a>
              .
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            API Tokens
          </h2>
          <ApiTokensSection meRole={role} />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            Integrations
          </h2>
          <AdminApiStatus />
        </section>

        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
            System
          </h2>
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-surface p-6">
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Database
              </h3>
              <p className="text-xs text-muted mb-3">
                AgentOps uses a local SQLite database to store run data.
              </p>
              <div className="rounded bg-surface-2 p-3 font-mono text-xs text-muted">
                {process.env.AGENTOPS_DB_PATH ?? "~/.agentops/agentops.db"}
              </div>
            </div>

            <div className="rounded-lg border border-border bg-surface p-6">
              <h3 className="text-sm font-semibold text-foreground mb-1">
                Version
              </h3>
              <p className="text-xs text-muted">@agentops/web v0.1.0</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
