import type { Metadata } from "next";
import { getSession, getUserById } from "@agentops/db";
import { createSessionId } from "@agentops/core";
import { db } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { getRequestUser } from "@/lib/auth";
import { SessionDetail } from "./SessionDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: `Session ${id.slice(0, 12)}` };
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getRequestUser();
  if (!user) redirect(`/login?next=/sessions/${encodeURIComponent(id)}`);

  const session = getSession(db(), createSessionId(id));
  if (!session) notFound();

  // Members can only view their own sessions. Admins see everything.
  if (user.role !== "admin" && session.userId && session.userId !== user.id) {
    notFound();
  }
  if (user.role !== "admin" && session.userId == null) {
    notFound();
  }

  const ownerUser = session.userId
    ? getUserById(db(), session.userId as string)
    : null;
  const owner = ownerUser
    ? { id: ownerUser.id, email: ownerUser.email, name: ownerUser.name }
    : null;

  return (
    <SessionDetail
      session={JSON.parse(JSON.stringify(session))}
      owner={owner}
    />
  );
}
