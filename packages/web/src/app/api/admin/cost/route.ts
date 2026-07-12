import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";

// The Anthropic Admin cost_report endpoint:
//   - requires `starting_at` (RFC 3339); `start_date`/`end_date` are not
//     parameters it knows about
//   - returns daily buckets with `amount` as a decimal string in CENTS
//   - paginates via has_more/next_page
// We normalize all of that server-side so the dashboard consumes a small
// stable shape instead of the raw report.

const MAX_DAYS = 31; // cost_report is 1d-bucketed with a 31-bucket maximum
const DEFAULT_DAYS = 30;
const MAX_PAGES = 8; // safety valve; 31 daily buckets never need this many

interface CostBucket {
  starting_at: string;
  ending_at: string;
  results: Array<{ amount: string; currency: string }>;
}

interface CostReportPage {
  data: CostBucket[];
  has_more: boolean;
  next_page: string | null;
}

export interface AdminCostSummary {
  totalCostUsd: number;
  daily: Array<{ date: string; costUsd: number }>;
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

    const buckets: CostBucket[] = [];
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
        `https://api.anthropic.com/v1/organizations/cost_report?${params.toString()}`,
        {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      if (!response.ok) {
        // Log full body server-side; do not echo upstream text to the browser
        // since it may contain request headers or tokens on certain 4xx responses.
        const errorText = await response.text();
        console.error(
          `[admin/cost] Anthropic API ${response.status}: ${errorText.slice(0, 500)}`,
        );
        return NextResponse.json(
          { error: `Anthropic API error: ${response.status}` },
          { status: response.status },
        );
      }

      const json = (await response.json()) as CostReportPage;
      buckets.push(...(json.data ?? []));
      page = json.has_more && json.next_page ? json.next_page : null;
      pagesLeft -= 1;
    } while (page && pagesLeft > 0);

    // Amounts are decimal strings in cents; sum in cents, convert once.
    let totalCents = 0;
    const daily = buckets
      .map((bucket) => {
        let bucketCents = 0;
        for (const result of bucket.results ?? []) {
          const amount = Number.parseFloat(result.amount);
          if (Number.isFinite(amount)) bucketCents += amount;
        }
        totalCents += bucketCents;
        return {
          date: bucket.starting_at.slice(0, 10),
          costUsd: bucketCents / 100,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const summary: AdminCostSummary = {
      totalCostUsd: totalCents / 100,
      daily,
      days,
      truncated: page !== null,
    };
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch cost data", details: message },
      { status: 502 },
    );
  }
}
