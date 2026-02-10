import { getJob } from "@agentops/db";
import { createJobId } from "@agentops/core";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { JobDetail } from "./JobDetail";

export const dynamic = "force-dynamic";

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = getJob(db(), createJobId(id));
  if (!job) notFound();

  return <JobDetail job={JSON.parse(JSON.stringify(job))} />;
}
