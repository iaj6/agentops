import { NextResponse, type NextRequest } from "next/server";
import { loadStarterPolicies } from "@agentops/db";
import { db } from "@/lib/db";
import { requireAdmin, checkSameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

// POST /api/policies/load-starters
//
// Admin-only. Idempotent — re-running is a no-op for already-present
// starters. Returns the human-readable names of what was inserted vs.
// what was skipped so the dashboard can toast a meaningful summary.
export async function POST(req: NextRequest) {
  const csrf = checkSameOrigin(req);
  if (csrf) return csrf;
  const user = await requireAdmin(req);
  if (user instanceof NextResponse) return user;

  const result = loadStarterPolicies(db());
  return NextResponse.json(result);
}
