"use client";

import { useAdminStatus, useAdminCost, useAdminAnalytics } from "@/hooks/useAdminApi";
import { MetricCard } from "@/components/MetricCard";

function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function NotConfiguredBanner() {
  return (
    <div className="rounded-lg border border-[#333] bg-[#111] p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#222] text-yellow-400">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">
            Anthropic Admin API Not Configured
          </h2>
          <p className="mt-1 text-sm text-[#888]">
            To view usage and cost data from the Anthropic API, set the{" "}
            <code className="rounded bg-[#222] px-1.5 py-0.5 font-mono text-xs text-[#ccc]">
              ANTHROPIC_ADMIN_API_KEY
            </code>{" "}
            environment variable before starting the dashboard.
          </p>
          <div className="mt-3 rounded bg-[#0a0a0a] p-3 font-mono text-xs text-[#888]">
            <p># Set the environment variable</p>
            <p className="text-[#ccc]">
              export ANTHROPIC_ADMIN_API_KEY=&quot;sk-ant-admin-...&quot;
            </p>
            <p className="mt-2"># Then start the dashboard</p>
            <p className="text-[#ccc]">agentops serve</p>
          </div>
          <p className="mt-3 text-xs text-[#666]">
            You can obtain an Admin API key from the Anthropic Console under
            Organization Settings.
          </p>
        </div>
      </div>
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

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

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

export default function UsagePage() {
  const { configured, loading: statusLoading } = useAdminStatus();
  const { data: costData, loading: costLoading, error: costError } =
    useAdminCost();
  const {
    data: analyticsData,
    loading: analyticsLoading,
    error: analyticsError,
  } = useAdminAnalytics();

  if (statusLoading) {
    return (
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white">Usage</h1>
          <p className="text-sm text-[#888]">
            Anthropic API cost and usage tracking
          </p>
        </div>
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-[#666]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Usage</h1>
        <p className="text-sm text-[#888]">
          Anthropic API cost and usage tracking
        </p>
      </div>

      {!configured && <NotConfiguredBanner />}

      {configured && (
        <>
          {/* Cost Overview */}
          {costLoading ? (
            <div className="rounded-lg border border-[#222] bg-[#111] p-6">
              <p className="text-sm text-[#666]">Loading cost data...</p>
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

          {/* Token Usage */}
          {analyticsLoading ? (
            <div className="rounded-lg border border-[#222] bg-[#111] p-6">
              <p className="text-sm text-[#666]">Loading token data...</p>
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
