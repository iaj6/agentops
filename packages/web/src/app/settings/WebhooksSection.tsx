"use client";

import { useEffect, useState } from "react";
import { toast } from "@/hooks/useToast";

interface WebhookRow {
  id: string;
  url: string;
  description: string | null;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  secretLast4: string;
}

interface DeliveryRow {
  id: string;
  eventId: string;
  eventType: string;
  status: "success" | "failed";
  attempts: number;
  responseStatus: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string;
}

interface WebhookDetail extends WebhookRow {
  deliveries: DeliveryRow[];
}

const EVENT_OPTIONS = [
  {
    type: "policy.violated",
    label: "Policy violations",
    description: "Fired when a run finishes with one or more failing policies",
  },
] as const;

export function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, WebhookDetail>>({});
  const [createdSecret, setCreatedSecret] = useState<{
    id: string;
    secret: string;
  } | null>(null);

  async function loadList() {
    const res = await fetch("/api/webhooks");
    if (res.status === 401 || res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    if (res.ok) {
      setWebhooks(await res.json());
    }
    setLoading(false);
  }

  useEffect(() => {
    loadList();
  }, []);

  async function loadDetail(id: string) {
    const res = await fetch(`/api/webhooks/${id}`);
    if (res.ok) {
      const data = (await res.json()) as WebhookDetail;
      setDetails((prev) => ({ ...prev, [id]: data }));
    }
  }

  async function handleToggle(w: WebhookRow) {
    const res = await fetch(`/api/webhooks/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !w.enabled }),
    });
    if (res.ok) {
      toast(`Webhook ${!w.enabled ? "enabled" : "disabled"}`, "success");
      await loadList();
    } else {
      toast("Failed to update webhook", "error");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this webhook and all delivery history?")) return;
    const res = await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast("Webhook deleted", "success");
      setWebhooks((prev) => prev.filter((w) => w.id !== id));
      setDetails((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } else {
      toast("Failed to delete webhook", "error");
    }
  }

  async function handleTest(id: string) {
    toast("Sending test ping...", "info");
    const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
    if (res.ok) {
      toast("Test delivered — see Recent deliveries below", "success");
      // Refresh details so the new delivery row shows up
      if (expandedId === id) await loadDetail(id);
      await loadList();
    } else {
      toast("Test ping failed", "error");
    }
  }

  if (forbidden) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6">
        <h2 className="text-sm font-semibold text-foreground mb-1">Webhooks</h2>
        <p className="text-xs text-muted">
          Admin role required to view and manage webhook subscriptions.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-1">Webhooks</h2>
          <p className="text-xs text-muted">
            Receive HMAC-SHA256 signed POSTs when policy violations occur.
            Verify the <code className="text-accent">X-AgentOps-Signature</code> header
            on your receiver using the secret we issue.
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
        >
          Add webhook
        </button>
      </div>

      {loading ? (
        <p className="text-xs text-muted">Loading...</p>
      ) : webhooks.length === 0 ? (
        <p className="text-xs text-muted">
          No webhooks configured. Add one to receive policy.violated events at
          your endpoint.
        </p>
      ) : (
        <div className="space-y-2">
          {webhooks.map((w) => (
            <div
              key={w.id}
              className="rounded-md border border-border bg-surface-2 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${w.enabled ? "bg-green" : "bg-muted/40"}`}
                      title={w.enabled ? "Enabled" : "Disabled"}
                    />
                    <span className="font-mono text-xs text-foreground truncate">
                      {w.url}
                    </span>
                  </div>
                  {w.description && (
                    <p className="mt-1 text-xs text-muted">{w.description}</p>
                  )}
                  <div className="mt-1 text-xs text-muted flex flex-wrap gap-x-3 gap-y-1">
                    <span>secret ...{w.secretLast4}</span>
                    <span>events: {w.events.join(", ")}</span>
                    {w.lastDeliveryAt ? (
                      <span>
                        last:{" "}
                        <span
                          className={
                            w.lastDeliveryStatus === "success"
                              ? "text-green"
                              : "text-red"
                          }
                        >
                          {w.lastDeliveryStatus}
                        </span>{" "}
                        ({new Date(w.lastDeliveryAt).toLocaleString()})
                      </span>
                    ) : (
                      <span>no deliveries yet</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleTest(w.id)}
                    className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Test
                  </button>
                  <button
                    onClick={() => handleToggle(w)}
                    className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    {w.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => {
                      if (expandedId === w.id) {
                        setExpandedId(null);
                      } else {
                        setExpandedId(w.id);
                        if (!details[w.id]) loadDetail(w.id);
                      }
                    }}
                    className="rounded border border-border px-2 py-1 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    {expandedId === w.id ? "Hide" : "Deliveries"}
                  </button>
                  <button
                    onClick={() => handleDelete(w.id)}
                    className="rounded border border-border px-2 py-1 text-xs text-red hover:bg-red/10 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {expandedId === w.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {details[w.id]?.deliveries.length === 0 ? (
                    <p className="text-xs text-muted">
                      No deliveries recorded yet.
                    </p>
                  ) : details[w.id] ? (
                    <table className="w-full text-xs">
                      <thead className="text-muted">
                        <tr className="text-left">
                          <th className="py-1 pr-3 font-medium">When</th>
                          <th className="py-1 pr-3 font-medium">Event</th>
                          <th className="py-1 pr-3 font-medium">Status</th>
                          <th className="py-1 pr-3 font-medium">Attempts</th>
                          <th className="py-1 font-medium">Response / Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {details[w.id]?.deliveries.map((d) => (
                          <tr key={d.id} className="border-t border-border/40">
                            <td className="py-1 pr-3 text-muted whitespace-nowrap">
                              {new Date(d.createdAt).toLocaleString()}
                            </td>
                            <td className="py-1 pr-3 font-mono text-accent">
                              {d.eventType}
                            </td>
                            <td
                              className={`py-1 pr-3 font-medium ${d.status === "success" ? "text-green" : "text-red"}`}
                            >
                              {d.status}
                            </td>
                            <td className="py-1 pr-3 text-muted">{d.attempts}</td>
                            <td className="py-1 text-muted truncate max-w-md">
                              {d.responseStatus !== null
                                ? `HTTP ${d.responseStatus}`
                                : (d.errorMessage ?? "—")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="text-xs text-muted">Loading deliveries...</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateWebhookDialog
          onClose={() => setShowCreate(false)}
          onCreated={(id, secret) => {
            setShowCreate(false);
            setCreatedSecret({ id, secret });
            loadList();
          }}
        />
      )}

      {createdSecret && (
        <NewSecretDialog
          secret={createdSecret.secret}
          onClose={() => setCreatedSecret(null)}
        />
      )}
    </div>
  );
}

function CreateWebhookDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string, secret: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [eventTypes, setEventTypes] = useState<string[]>(["policy.violated"]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        description: description || undefined,
        events: eventTypes,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { id: string; secret: string };
      onCreated(data.id, data.secret);
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "Failed to create webhook");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl p-6"
      >
        <h3 className="text-sm font-semibold text-foreground mb-4">
          New webhook
        </h3>
        <label className="block mb-3">
          <span className="text-xs text-muted block mb-1">URL</span>
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.example.com/agentops"
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm font-mono"
          />
        </label>
        <label className="block mb-3">
          <span className="text-xs text-muted block mb-1">
            Description (optional)
          </span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded border border-border bg-surface-2 px-3 py-2 text-sm"
          />
        </label>
        <div className="mb-4">
          <span className="text-xs text-muted block mb-2">Events</span>
          {EVENT_OPTIONS.map((opt) => (
            <label key={opt.type} className="flex items-start gap-2 mb-1">
              <input
                type="checkbox"
                checked={eventTypes.includes(opt.type)}
                onChange={(e) => {
                  setEventTypes((prev) =>
                    e.target.checked
                      ? [...prev, opt.type]
                      : prev.filter((t) => t !== opt.type),
                  );
                }}
                className="mt-0.5"
              />
              <div>
                <div className="text-sm text-foreground font-mono">{opt.type}</div>
                <div className="text-xs text-muted">{opt.description}</div>
              </div>
            </label>
          ))}
        </div>
        {error && (
          <p className="text-xs text-red mb-3">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting || eventTypes.length === 0}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewSecretDialog({
  secret,
  onClose,
}: {
  secret: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl p-6">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          Webhook secret
        </h3>
        <p className="text-xs text-muted mb-3">
          Store this secret on your receiver. AgentOps will not show it again.
          Use it to verify the <code className="text-accent">X-AgentOps-Signature</code>{" "}
          HMAC on every incoming POST.
        </p>
        <div className="rounded border border-border bg-surface-2 p-3 font-mono text-xs text-foreground break-all mb-3">
          {secret}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                toast("Clipboard unavailable", "error");
              }
            }}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
