import { getRun, getRunSummary } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { RunDetail } from "./RunDetail";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const d = db();
  const runId = createRunId(id);
  const run = getRun(d, runId);
  if (!run) notFound();
  const summary = getRunSummary(d, runId);

  return (
    <RunDetail
      run={JSON.parse(JSON.stringify(run))}
      initialSummary={summary ? JSON.parse(JSON.stringify(summary)) : null}
    />
  );
}
