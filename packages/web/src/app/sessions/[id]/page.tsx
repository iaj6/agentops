import { getSession } from "@agentops/db";
import { createSessionId } from "@agentops/core";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SessionDetail } from "./SessionDetail";

export const dynamic = "force-dynamic";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSession(db(), createSessionId(id));
  if (!session) notFound();

  return <SessionDetail session={JSON.parse(JSON.stringify(session))} />;
}
