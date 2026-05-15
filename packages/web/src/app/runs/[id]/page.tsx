import { getRun, getRunSummary, getUserById } from "@agentops/db";
import { createRunId } from "@agentops/core";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { RunDetail } from "./RunDetail";

export const dynamic = "force-dynamic";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getRequestUser();
  if (!user) redirect(`/login?next=/runs/${encodeURIComponent(id)}`);

  const d = db();
  const runId = createRunId(id);
  const run = getRun(d, runId);
  if (!run) notFound();

  // Members can only view their own runs. Admins see everything. We 404
  // (rather than 403) to avoid leaking which run IDs exist.
  if (user.role !== "admin" && run.userId && run.userId !== user.id) {
    notFound();
  }
  // Pre-auth runs (userId === null) are only visible to admins.
  if (user.role !== "admin" && run.userId == null) {
    notFound();
  }

  const summary = getRunSummary(d, runId);

  // Resolve the run owner once on the server — the header chip wants
  // the display name, not the raw userId. null userId is intentional
  // (pre-auth records), so pass that through as null rather than skip.
  const ownerUser = run.userId ? getUserById(d, run.userId as string) : null;
  const owner = ownerUser
    ? { id: ownerUser.id, email: ownerUser.email, name: ownerUser.name }
    : null;

  return (
    <RunDetail
      run={JSON.parse(JSON.stringify(run))}
      initialSummary={summary ? JSON.parse(JSON.stringify(summary)) : null}
      owner={owner}
    />
  );
}
