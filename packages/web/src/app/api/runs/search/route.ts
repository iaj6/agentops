import { NextRequest, NextResponse } from "next/server";
import { searchRuns, countRuns, getDistinctRepos, getDistinctBranches } from "@agentops/db";
import type { SearchRunsFilters } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const filters: SearchRunsFilters = {
      q: params.get("q") ?? undefined,
      status: params.getAll("status").length > 0 ? params.getAll("status") : undefined,
      repo: params.getAll("repo").length > 0 ? params.getAll("repo") : undefined,
      branch: params.getAll("branch").length > 0 ? params.getAll("branch") : undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      minCost: params.get("minCost") ? Number(params.get("minCost")) : undefined,
      maxCost: params.get("maxCost") ? Number(params.get("maxCost")) : undefined,
      sortBy: (params.get("sortBy") as SearchRunsFilters["sortBy"]) ?? undefined,
      sortDir: (params.get("sortDir") as SearchRunsFilters["sortDir"]) ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : 50,
      offset: params.get("offset") ? Number(params.get("offset")) : 0,
    };

    const database = db();
    const runs = searchRuns(database, filters);
    const total = countRuns(database, filters);

    return NextResponse.json({ runs, total });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

/** GET /api/runs/search?meta=1 — returns filter options (repos, branches) */
export async function POST(request: NextRequest) {
  try {
    const database = db();
    const repos = getDistinctRepos(database);
    const branches = getDistinctBranches(database);

    return NextResponse.json({ repos, branches });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
