"use client";

import { useState } from "react";

type Status = "idle" | "submitting" | "approved" | "denied" | "error";

export function DeviceApprovalForm({ prefill }: { prefill: string }) {
  const [userCode, setUserCode] = useState(prefill);
  const [tokenName, setTokenName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit(action: "approve" | "deny") {
    setErrorMsg(null);
    setStatus("submitting");
    try {
      const res = await fetch("/api/auth/device/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_code: userCode.trim(),
          action,
          name: tokenName.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setErrorMsg(data.error ?? `Failed (HTTP ${res.status})`);
        setStatus("error");
        return;
      }
      setStatus(action === "approve" ? "approved" : "denied");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Network error");
      setStatus("error");
    }
  }

  if (status === "approved") {
    return (
      <div className="rounded-lg border border-green/30 bg-green/5 p-6 text-center space-y-2">
        <p className="text-sm font-medium text-green">Device approved</p>
        <p className="text-xs text-muted">
          Return to your terminal — the CLI should complete sign-in within a few
          seconds.
        </p>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="rounded-lg border border-yellow/30 bg-yellow/5 p-6 text-center space-y-2">
        <p className="text-sm font-medium text-yellow">Device denied</p>
        <p className="text-xs text-muted">
          The CLI that initiated this request will not receive a token.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4">
      {errorMsg && (
        <div className="rounded-md bg-red/10 border border-red/20 px-3 py-2 text-sm text-red">
          {errorMsg}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
          Code
        </label>
        <input
          type="text"
          value={userCode}
          onChange={(e) => setUserCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          autoFocus={!prefill}
          required
          maxLength={9}
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-base font-mono tracking-widest text-center text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="mt-1 text-xs text-muted">
          The code displayed by your CLI. Codes expire after 15 minutes.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
          Device name (optional)
        </label>
        <input
          type="text"
          value={tokenName}
          onChange={(e) => setTokenName(e.target.value)}
          placeholder="e.g. work-laptop"
          maxLength={80}
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <p className="mt-1 text-xs text-muted">
          Shown next to the token in your settings so you can recognize and
          revoke it later.
        </p>
      </div>

      <div className="flex gap-3 pt-1">
        <button
          type="button"
          onClick={() => submit("deny")}
          disabled={status === "submitting" || userCode.trim().length === 0}
          className="flex-1 rounded-md border border-border px-3 py-2 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
        >
          Deny
        </button>
        <button
          type="button"
          onClick={() => submit("approve")}
          disabled={status === "submitting" || userCode.trim().length === 0}
          className="flex-1 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {status === "submitting" ? "Working…" : "Approve"}
        </button>
      </div>

      <p className="text-xs text-muted text-center pt-1">
        Only approve codes from devices you control.
      </p>
    </div>
  );
}
