import { NextRequest, NextResponse } from "next/server";
import { listLocks, insertLock, getActiveLocks } from "@agentops/db";
import { createLock, checkConflicts, LockType } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const resource = params.get("resource") ?? undefined;
    const active = params.get("active") === "true" ? true : undefined;
    const limit = params.get("limit") ? Number(params.get("limit")) : 50;
    const offset = params.get("offset") ? Number(params.get("offset")) : 0;

    const locks = listLocks(db(), { resource, active, limit, offset });
    return NextResponse.json(locks);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { lockType, resource, holderId, durationMs } = body;

    if (!lockType || typeof lockType !== "string") {
      return NextResponse.json(
        { error: "lockType is required and must be a string" },
        { status: 400 },
      );
    }

    if (!resource || typeof resource !== "string") {
      return NextResponse.json(
        { error: "resource is required and must be a string" },
        { status: 400 },
      );
    }

    if (!holderId || typeof holderId !== "string") {
      return NextResponse.json(
        { error: "holderId is required and must be a string" },
        { status: 400 },
      );
    }

    if (!Object.values(LockType).includes(lockType as LockType)) {
      return NextResponse.json(
        { error: `Invalid lockType. Must be one of: ${Object.values(LockType).join(", ")}` },
        { status: 400 },
      );
    }

    const active = getActiveLocks(db(), resource as string);
    const conflicts = checkConflicts(resource as string, lockType as LockType, active);

    if (conflicts.hasConflict) {
      return NextResponse.json(
        { error: conflicts.message, conflictingLocks: conflicts.conflictingLocks },
        { status: 409 },
      );
    }

    const dur = typeof durationMs === "number" ? durationMs : 300000;
    const lock = createLock(lockType as LockType, resource as string, holderId as string, dur);
    insertLock(db(), lock);

    return NextResponse.json(lock, { status: 201 });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
