import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  listRunsWithSummaries,
  listSessions,
  getPolicyResults,
  getPolicy,
} from "@agentops/db";
import { createRunId, createPolicyId } from "@agentops/core";
import { db } from "@/lib/db";
import { getRequestUser } from "@/lib/auth";
import { HomeDashboard } from "./HomeDashboard";

export const metadata: Metadata = {
  title: "Home",
};

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const SPARK_DAYS = 14;

export default async function HomePage() {
  const user = await getRequestUser();
  if (!user) redirect("/login?next=/");

  const database = db();
  const now = Date.now();
  const weekAgo = now - WEEK_MS;
  const monthAgo = now - MONTH_MS;
  const sparkStart = now - SPARK_DAYS * DAY_MS;

  // Pull a generous window of the user's runs once and aggregate
  // client-free. listRunsWithSummaries returns newest first.
  const runsWithSummaries = listRunsWithSummaries(database, {
    limit: 80,
    userId: user.id,
  });

  let weekCostUsd = 0;
  let monthCostUsd = 0;
  let weekRunCount = 0;
  let monthRunCount = 0;
  const sparkBuckets = new Array<number>(SPARK_DAYS).fill(0);

  for (const { run } of runsWithSummaries) {
    const created = new Date(run.createdAt).getTime();
    const cost = run.metrics.costUsd ?? 0;
    if (created >= monthAgo) {
      monthCostUsd += cost;
      monthRunCount += 1;
    }
    if (created >= weekAgo) {
      weekCostUsd += cost;
      weekRunCount += 1;
    }
    if (created >= sparkStart) {
      const idx = Math.min(
        SPARK_DAYS - 1,
        Math.floor((created - sparkStart) / DAY_MS),
      );
      sparkBuckets[idx] += 1;
    }
  }

  const recentRuns = runsWithSummaries.slice(0, 6);

  const activeSessions = listSessions(database, {
    status: "active",
    userId: user.id,
    limit: 5,
  });

  // Recent policy violations: walk the user's last 20 runs and collect
  // any failing policy_results. N+1 but N is small and bounded.
  const policyNameCache = new Map<string, string>();
  function resolvePolicyName(policyId: string): string {
    if (policyNameCache.has(policyId)) return policyNameCache.get(policyId)!;
    const policy = getPolicy(database, createPolicyId(policyId));
    const name = policy?.name ?? "Policy";
    policyNameCache.set(policyId, name);
    return name;
  }

  type Violation = {
    policyName: string;
    message: string;
    runId: string;
    evaluatedAt: string;
  };
  const violations: Violation[] = [];
  for (const { run } of runsWithSummaries.slice(0, 20)) {
    const results = getPolicyResults(database, createRunId(run.id as string));
    for (const r of results) {
      if (r.passed) continue;
      violations.push({
        policyName: resolvePolicyName(r.policyId),
        message: r.message,
        runId: r.runId,
        evaluatedAt: r.evaluatedAt,
      });
    }
  }
  violations.sort((a, b) => b.evaluatedAt.localeCompare(a.evaluatedAt));
  const recentViolations = violations.slice(0, 5);

  return (
    <HomeDashboard
      userName={user.name ?? user.email.split("@")[0] ?? "there"}
      userEmail={user.email}
      recentRuns={JSON.parse(JSON.stringify(recentRuns))}
      activeSessions={JSON.parse(JSON.stringify(activeSessions))}
      weekCostUsd={weekCostUsd}
      monthCostUsd={monthCostUsd}
      weekRunCount={weekRunCount}
      monthRunCount={monthRunCount}
      sparkData={sparkBuckets}
      recentViolations={recentViolations}
    />
  );
}
