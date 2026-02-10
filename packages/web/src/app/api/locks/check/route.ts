import { NextRequest, NextResponse } from "next/server";
import { getActiveLocks } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const resource = request.nextUrl.searchParams.get("resource");

  if (!resource) {
    return NextResponse.json(
      { error: "resource query parameter is required" },
      { status: 400 },
    );
  }

  const active = getActiveLocks(db(), resource);

  return NextResponse.json({
    resource,
    locked: active.length > 0,
    locks: active,
  });
}
