import { NextRequest, NextResponse } from "next/server";
import { getLock, updateLock } from "@agentops/db";
import { createLockId } from "@agentops/core";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const lock = getLock(db(), createLockId(id));

    if (!lock) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 });
    }

    return NextResponse.json(lock);
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const lock = getLock(db(), createLockId(id));

    if (!lock) {
      return NextResponse.json({ error: "Lock not found" }, { status: 404 });
    }

    if (lock.released) {
      return NextResponse.json({ error: "Lock already released" }, { status: 400 });
    }

    updateLock(db(), createLockId(id), { released: true });

    return NextResponse.json({ id, released: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
