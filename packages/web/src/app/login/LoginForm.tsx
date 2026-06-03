"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { safeNextPath } from "@/lib/safe-redirect";

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Sign-in failed (HTTP ${res.status})`);
        return;
      }

      const data = (await res.json()) as {
        user: { mustChangePassword: boolean };
      };
      // Never redirect to an attacker-controlled absolute URL.
      const dest = safeNextPath(next);
      const target = data.user.mustChangePassword
        ? `/change-password?next=${encodeURIComponent(dest)}`
        : dest;
      router.push(target);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-surface p-6 shadow-xl space-y-4"
    >
      {error && (
        <div className="rounded-md bg-red/10 border border-red/20 px-3 py-2 text-sm text-red">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
          Email
        </label>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="block text-xs font-medium uppercase tracking-wider text-muted mb-1.5">
          Password
        </label>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>

      <p className="text-xs text-muted text-center pt-2">
        Don&apos;t have an account? Ask your admin to run{" "}
        <code className="font-mono text-foreground">agentops user add</code>.
      </p>
    </form>
  );
}
