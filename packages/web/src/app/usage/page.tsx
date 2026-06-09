"use client";

import { useEffect, useState } from "react";
import { useAdminStatus, useAdminCost, useAdminAnalytics } from "@/hooks/useAdminApi";
import { MetricCard } from "@/components/MetricCard";

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1000) return `$${usd.toFixed(2)}`;
  return `$${usd.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface LocalUsage {
  totalCost: number;
  totalCost30d: number;
  totalCost7d: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalRuns: number;
  runsWithCost: number;
  costByBackend?: {
    bedrock: number;
    anthropic: number;
    unknown: number;
  };
  bedrockIsEstimate?: boolean;
  bedrockRatesVerifiedDate?: string;
}

function BackendBreakdown({ data }: { data: LocalUsage }) {
  const split = data.costByBackend;
  // Only meaningful once there's captured spend to split.
  if (!split || data.totalCost <= 0) return null;

  const bedrockEstimated = !!data.bedrockIsEstimate && split.bedrock > 0;

  const tiles: { label: string; value: number; hint?: string }[] = [
    { label: "AWS Bedrock", value: split.bedrock },
    { label: "Anthropic Direct", value: split.anthropic },
    {
      label: "Not yet classified",
      value: split.unknown,
      hint: "Runs recorded before backend tagging, or reported without a backend tag.",
    },
  ];

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-[#777]">
          By backend
        </h3>
        {bedrockEstimated && (
          <span
            title={`Bedrock token volumes and attribution are exact; dollar amounts are estimated at Anthropic-direct US rates${
              data.bedrockRatesVerifiedDate
                ? ` (verified ${data.bedrockRatesVerifiedDate})`
                : ""
            } pending AWS rate verification.`}
            className="cursor-help rounded border border-[#3a3320] bg-[#1c1810] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#caa45a]"
          >
            Bedrock est.
          </span>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div
            key={t.label}
            title={t.hint}
            className="rounded-lg border border-[#1d1d1d] bg-[#0d0d0d] px-3 py-2.5"
          >
            <p className="text-[11px] text-[#888]">{t.label}</p>
            <p className="mt-0.5 font-mono text-sm text-[#ddd]">
              {formatCost(t.value)}
            </p>
          </div>
        ))}
      </div>
      {bedrockEstimated && (
        <p className="mt-2 text-[11px] leading-relaxed text-[#666]">
          Bedrock token volumes and attribution are exact; dollar amounts are
          estimated at Anthropic-direct US rates
          {data.bedrockRatesVerifiedDate
            ? ` (verified ${data.bedrockRatesVerifiedDate})`
            : ""}{" "}
          pending AWS rate verification.
        </p>
      )}
    </div>
  );
}

function LocalUsageSection({ data }: { data: LocalUsage }) {
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-[#888]">
          From AgentOps Hooks
        </h2>
        <p className="text-xs text-[#666]">
          Captured locally from Claude Code transcripts
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Total Spend"
          value={formatCost(data.totalCost)}
          sub={
            data.totalCost30d > 0
              ? `${formatCost(data.totalCost30d)} last 30d`
              : `${data.totalRuns} runs`
          }
        />
        <MetricCard
          label="Last 7 Days"
          value={formatCost(data.totalCost7d)}
        />
        <MetricCard
          label="Total Tokens"
          value={formatTokens(data.totalTokens)}
          sub={`${formatTokens(data.inputTokens)} in / ${formatTokens(data.outputTokens)} out`}
        />
        <MetricCard
          label="Runs with Cost"
          value={`${data.runsWithCost} / ${data.totalRuns}`}
          sub={
            data.totalRuns > 0 && data.runsWithCost === 0
              ? "no runs captured yet"
              : undefined
          }
        />
      </div>
      <BackendBreakdown data={data} />
    </div>
  );
}

function NotConfiguredBanner() {
  return (
    <div className="rounded-lg border border-[#222] bg-[#0d0d0d] p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-[#888]">
        Anthropic Admin API
      </p>
      <p className="mt-2 text-sm text-[#aaa]">
        For org-wide Anthropic usage (across all of your usage, not just
        what AgentOps captured), set{" "}
        <code className="rounded bg-[#222] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">
          ANTHROPIC_ADMIN_API_KEY
        </code>{" "}
        and restart{" "}
        <code className="rounded bg-[#222] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">
          agentops serve
        </code>
        . Obtain the key from the Anthropic Console under Organization
        Settings.
      </p>
    </div>
  );
}

function CostOverview({ data }: { data: Record<string, unknown> }) {
  const totalSpend =
    typeof data.total_cost === "number" ? data.total_cost : 0;
  const dailyData = Array.isArray(data.daily) ? data.daily : [];
  const dailyAvg =
    dailyData.length > 0 ? totalSpend / dailyData.length : 0;
  const periodDays = dailyData.length || 1;

  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#888]">
        Cost Overview
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <MetricCard label="Total Spend" value={formatCost(totalSpend)} />
        <MetricCard
          label="Daily Average"
          value={formatCost(dailyAvg)}
          sub={`over ${periodDays} days`}
        />
        <MetricCard
          label="Period"
          value={`${periodDays}d`}
          sub="date range"
        />
        <MetricCard
          label="Projected Monthly"
          value={formatCost(dailyAvg * 30)}
          sub="at current rate"
        />
      </div>
    </div>
  );
}

function TokenUsage({ data }: { data: Record<string, unknown> }) {
  const inputTokens =
    typeof data.input_tokens === "number" ? data.input_tokens : 0;
  const outputTokens =
    typeof data.output_tokens === "number" ? data.output_tokens : 0;
  const totalTokens = inputTokens + outputTokens;

  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#888]">
        Token Usage
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard label="Total Tokens" value={formatTokens(totalTokens)} />
        <MetricCard
          label="Input Tokens"
          value={formatTokens(inputTokens)}
          sub={
            totalTokens > 0
              ? `${((inputTokens / totalTokens) * 100).toFixed(0)}% of total`
              : undefined
          }
        />
        <MetricCard
          label="Output Tokens"
          value={formatTokens(outputTokens)}
          sub={
            totalTokens > 0
              ? `${((outputTokens / totalTokens) * 100).toFixed(0)}% of total`
              : undefined
          }
        />
      </div>
    </div>
  );
}

function ActivitySummary({ data }: { data: Record<string, unknown> }) {
  const sessions =
    typeof data.total_sessions === "number" ? data.total_sessions : 0;
  const linesOfCode =
    typeof data.lines_of_code === "number" ? data.lines_of_code : null;
  const requests =
    typeof data.total_requests === "number" ? data.total_requests : 0;

  return (
    <div>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wider text-[#888]">
        Activity Summary
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard label="API Requests" value={String(requests)} />
        <MetricCard label="Sessions" value={String(sessions)} />
        {linesOfCode !== null && (
          <MetricCard
            label="Lines of Code"
            value={
              linesOfCode >= 1000
                ? `${(linesOfCode / 1000).toFixed(1)}K`
                : String(linesOfCode)
            }
          />
        )}
      </div>
    </div>
  );
}

function useLocalUsage(): { data: LocalUsage | null; loading: boolean } {
  const [data, setData] = useState<LocalUsage | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/usage/local")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LocalUsage | null) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { data, loading };
}

export default function UsagePage() {
  const { configured, loading: statusLoading } = useAdminStatus();
  const { data: costData, loading: costLoading, error: costError } =
    useAdminCost();
  const {
    data: analyticsData,
    loading: analyticsLoading,
    error: analyticsError,
  } = useAdminAnalytics();
  const { data: localData, loading: localLoading } = useLocalUsage();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Usage</h1>
        <p className="text-sm text-[#888]">
          Spend and token usage across your agent runs
        </p>
      </div>

      {/* AgentOps local rollup — always shown so the page is useful
          even without the Admin API key. */}
      {localLoading ? (
        <div className="rounded-lg border border-[#222] bg-[#111] p-6">
          <p className="text-sm text-[#666]">Loading local usage...</p>
        </div>
      ) : localData ? (
        <LocalUsageSection data={localData} />
      ) : null}

      {/* Anthropic Admin API — additive when configured, otherwise a
          small note that points to the env var. */}
      {statusLoading ? null : !configured ? (
        <NotConfiguredBanner />
      ) : (
        <>
          {costLoading ? (
            <div className="rounded-lg border border-[#222] bg-[#111] p-6">
              <p className="text-sm text-[#666]">Loading Admin API cost data...</p>
            </div>
          ) : costError ? (
            <div className="rounded-lg border border-[#333] bg-[#111] p-6">
              <p className="text-sm text-red-400">
                Failed to load cost data: {costError}
              </p>
            </div>
          ) : costData ? (
            <CostOverview data={costData} />
          ) : null}

          {analyticsLoading ? (
            <div className="rounded-lg border border-[#222] bg-[#111] p-6">
              <p className="text-sm text-[#666]">Loading Admin API token data...</p>
            </div>
          ) : analyticsError ? (
            <div className="rounded-lg border border-[#333] bg-[#111] p-6">
              <p className="text-sm text-red-400">
                Failed to load analytics: {analyticsError}
              </p>
            </div>
          ) : analyticsData ? (
            <>
              <TokenUsage data={analyticsData} />
              <ActivitySummary data={analyticsData} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
