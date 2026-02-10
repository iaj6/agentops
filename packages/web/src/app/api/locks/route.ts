import { NextRequest, NextResponse } from "next/server";
import { listLocks, insertLock, getActiveLocks } from "@agentops/db";
import { createLock, checkConflicts, LockType } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const resource = params.get("resource") ?? undefined;
  const active = params.get("active") === "true" ? true : undefined;
  const limit = params.get("limit") ? Number(params.get("limit")) : 50;
  const offset = params.get("offset") ? Number(params.get("offset")) : 0;

  const locks = listLocks(db(), { resource, active, limit, offset });
  return NextResponse.json(locks);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { lockType, resource, holderId, durationMs } = body;

  if (!lockType || !resource || !holderId) {
    return NextResponse.json(
      { error: "lockType, resource, and holderId are required" },
      { status: 400 },
    );
  }

  if (!Object.values(LockType).includes(lockType)) {
    return NextResponse.json(
      { error: `Invalid lockType. Must be one of: ${Object.values(LockType).join(", ")}` },
      { status: 400 },
    );
  }

  const active = getActiveLocks(db(), resource);
  const conflicts = checkConflicts(resource, lockType, active);

  if (conflicts.hasConflict) {
    return NextResponse.json(
      { error: conflicts.message, conflictingLocks: conflicts.conflictingLocks },
      { status: 409 },
    );
  }

  const lock = createLock(lockType, resource, holderId, durationMs ?? 300000);
  insertLock(db(), lock);

  return NextResponse.json(lock, { status: 201 });
}
