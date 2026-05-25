"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BudgetRowProps } from "./page";
import { toast } from "@/hooks/useToast";

function formatCost(usd: number): string {
  if (usd === 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const statusBadge: Record<string, string> = {
  ok: "bg-green/15 text-green border-green/30",
  warning: "bg-yellow/15 text-yellow border-yellow/30",
  breached: "bg-red/15 text-red border-red/30",
};

export function BudgetsTable({ rows }: { rows: BudgetRowProps[] }) {
  const [editingUser, setEditingUser] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-border bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-xs uppercase tracking-wider text-muted">
          <tr>
            <th className="text-left px-4 py-3">User</th>
            <th className="text-left px-4 py-3">Budget</th>
            <th className="text-left px-4 py-3">Period</th>
            <th className="text-left px-4 py-3">Spent this period</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <BudgetRow
              key={row.userId}
              row={row}
              isEditing={editingUser === row.userId}
              onEdit={() => setEditingUser(row.userId)}
              onClose={() => setEditingUser(null)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetRow({
  row,
  isEditing,
  onEdit,
  onClose,
}: {
  row: BudgetRowProps;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const status = row.state?.status ?? "ok";
  const badgeClass = statusBadge[status] ?? statusBadge.ok;

  return (
    <>
      <tr className="hover:bg-surface-2/50">
        <td className="px-4 py-3">
          <p className="text-foreground">{row.userName ?? row.userEmail}</p>
          {row.userName && (
            <p className="text-xs text-muted font-mono">{row.userEmail}</p>
          )}
        </td>
        <td className="px-4 py-3 font-mono">
          {row.budget ? formatCost(row.budget.amountUsd) : <span className="text-muted">—</span>}
        </td>
        <td className="px-4 py-3 text-muted">
          {row.budget ? row.budget.period : "—"}
        </td>
        <td className="px-4 py-3 font-mono">
          {row.state ? (
            <span>
              {formatCost(row.state.spent)}{" "}
              <span className="text-xs text-muted">({row.state.pct}%)</span>
            </span>
          ) : (
            <span className="text-muted">—</span>
          )}
        </td>
        <td className="px-4 py-3">
          {row.budget ? (
            <span
              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${badgeClass}`}
            >
              {status}
            </span>
          ) : (
            <span className="text-xs text-muted">no budget</span>
          )}
        </td>
        <td className="px-4 py-3 text-right">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs text-accent hover:underline"
          >
            {row.budget ? "Edit" : "Set budget"}
          </button>
        </td>
      </tr>
      {isEditing && (
        <tr className="bg-surface-2/40">
          <td colSpan={6} className="px-4 py-4">
            <BudgetEditor row={row} onClose={onClose} />
          </td>
        </tr>
      )}
    </>
  );
}

function BudgetEditor({
  row,
  onClose,
}: {
  row: BudgetRowProps;
  onClose: () => void;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(row.budget?.amountUsd ?? 50));
  const [period, setPeriod] = useState<"week" | "month">(
    row.budget?.period ?? "month",
  );
  const [warnAtPct, setWarnAtPct] = useState(String(row.budget?.warnAtPct ?? 80));
  const [submitting, setSubmitting] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const amountNum = Number(amount);
    const warnNum = Number(warnAtPct);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast("Amount must be a positive number", "error");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/budgets/${row.userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountUsd: amountNum,
          period,
          warnAtPct: warnNum,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save budget");
      }
      toast("Budget saved", "success");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save", "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!row.budget) return;
    if (!confirm(`Remove budget for ${row.userName ?? row.userEmail}?`)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/budgets/${row.userId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast("Budget removed", "success");
      onClose();
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:border-accent focus:outline-none";

  return (
    <form onSubmit={handleSave} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        Amount (USD)
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          step="1"
          min="0"
          className={`${inputClass} w-28 font-mono`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Period
        <select
          value={period}
          onChange={(e) => setPeriod(e.target.value as "week" | "month")}
          className={`${inputClass} w-28`}
        >
          <option value="week">Week</option>
          <option value="month">Month</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        Warn at %
        <input
          type="number"
          value={warnAtPct}
          onChange={(e) => setWarnAtPct(e.target.value)}
          min="0"
          max="100"
          className={`${inputClass} w-20 font-mono`}
        />
      </label>
      <div className="ml-auto flex gap-2">
        {row.budget && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="rounded-md border border-red/30 px-3 py-1.5 text-xs text-red hover:bg-red/10 disabled:opacity-50"
          >
            Remove
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
