import { getRun } from "@agentops/db";
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
  const run = getRun(db(), createRunId(id));
  if (!run) notFound();

  return <RunDetail run={JSON.parse(JSON.stringify(run))} />;
}
