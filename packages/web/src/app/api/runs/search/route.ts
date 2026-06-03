import { NextRequest, NextResponse } from "next/server";
import { searchRuns, countRuns, getDistinctRepos, getDistinctBranches } from "@agentops/db";
import type { SearchRunsFilters } from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser, resolveViewScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const params = request.nextUrl.searchParams;
    const scope = resolveViewScope(user, params);

    // Drop non-finite numeric filters (Number("abc")→NaN, "Infinity"→Infinity)
    // rather than letting them silently produce empty/garbage result sets in
    // the JS-side cost filter.
    const finiteParam = (v: string | null): number | undefined => {
      if (v === null || v === "") return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const intParam = (v: string | null, def: number): number => {
      if (v === null || v === "") return def;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 ? n : def;
    };

    const filters: SearchRunsFilters = {
      q: params.get("q") ?? undefined,
      status: params.getAll("status").length > 0 ? params.getAll("status") : undefined,
      repo: params.getAll("repo").length > 0 ? params.getAll("repo") : undefined,
      branch: params.getAll("branch").length > 0 ? params.getAll("branch") : undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
      minCost: finiteParam(params.get("minCost")),
      maxCost: finiteParam(params.get("maxCost")),
      sortBy: (params.get("sortBy") as SearchRunsFilters["sortBy"]) ?? undefined,
      sortDir: (params.get("sortDir") as SearchRunsFilters["sortDir"]) ?? undefined,
      limit: intParam(params.get("limit"), 50),
      offset: intParam(params.get("offset"), 0),
      // Members are always scoped to their own runs; admins see the team
      // unless they opted into "mine" view via ?view=mine.
      ...(scope.userId ? { userId: scope.userId } : {}),
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

/** POST /api/runs/search — returns filter options (repos, branches) */
export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;

  try {
    const database = db();
    // Scope the filter options to what the caller can actually see: members
    // only get repos/branches from their own runs, matching the scoped GET.
    const scope = resolveViewScope(user, request.nextUrl.searchParams);
    const repos = getDistinctRepos(database, scope.userId);
    const branches = getDistinctBranches(database, scope.userId);

    return NextResponse.json({ repos, branches });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
