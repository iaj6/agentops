import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";

// The Anthropic Admin usage_report/messages endpoint:
//   - requires `starting_at` (RFC 3339); `start_date`/`end_date` are not
//     parameters it knows about
//   - returns time buckets whose results carry uncached_input_tokens,
//     cache_read_input_tokens, cache_creation.{ephemeral_5m,1h}_input_tokens,
//     output_tokens, and server_tool_use.web_search_requests
//   - paginates via has_more/next_page
// We normalize into org-wide token totals for the dashboard.

const MAX_DAYS = 31;
const DEFAULT_DAYS = 30;
const MAX_PAGES = 8;

interface UsageResult {
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  };
  output_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

interface UsageBucket {
  starting_at: string;
  ending_at: string;
  results: UsageResult[];
}

interface UsageReportPage {
  data: UsageBucket[];
  has_more: boolean;
  next_page: string | null;
}

export interface AdminUsageSummary {
  uncachedInputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  outputTokens: number;
  webSearchRequests: number;
  days: number;
  truncated: boolean;
}

function windowStart(days: number): string {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start.toISOString();
}

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;

  const apiKey = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Anthropic Admin API key not configured" },
      { status: 501 },
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const daysRaw = Number(searchParams.get("days") ?? DEFAULT_DAYS);
    const days = Number.isFinite(daysRaw)
      ? Math.min(Math.max(Math.trunc(daysRaw), 1), MAX_DAYS)
      : DEFAULT_DAYS;

    const buckets: UsageBucket[] = [];
    let page: string | null = null;
    let pagesLeft = MAX_PAGES;

    do {
      const params = new URLSearchParams({
        starting_at: windowStart(days),
        bucket_width: "1d",
        limit: String(MAX_DAYS),
      });
      if (page) params.set("page", page);

      const response = await fetch(
        `https://api.anthropic.com/v1/organizations/usage_report/messages?${params.toString()}`,
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `[admin/analytics] Anthropic API ${response.status}: ${errorText.slice(0, 500)}`,
        );
        return NextResponse.json(
          { error: `Anthropic API error: ${response.status}` },
          { status: response.status },
        );
      }

      const json = (await response.json()) as UsageReportPage;
      buckets.push(...(json.data ?? []));
      page = json.has_more && json.next_page ? json.next_page : null;
      pagesLeft -= 1;
    } while (page && pagesLeft > 0);

    const summary: AdminUsageSummary = {
      uncachedInputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      outputTokens: 0,
      webSearchRequests: 0,
      days,
      truncated: page !== null,
    };
    for (const bucket of buckets) {
      for (const result of bucket.results ?? []) {
        summary.uncachedInputTokens += result.uncached_input_tokens ?? 0;
        summary.cacheReadInputTokens += result.cache_read_input_tokens ?? 0;
        summary.cacheCreationInputTokens +=
          (result.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
          (result.cache_creation?.ephemeral_1h_input_tokens ?? 0);
        summary.outputTokens += result.output_tokens ?? 0;
        summary.webSearchRequests +=
          result.server_tool_use?.web_search_requests ?? 0;
      }
    }

    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch analytics data", details: message },
      { status: 502 },
    );
  }
}
