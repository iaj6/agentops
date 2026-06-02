import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";

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
    const startDate = searchParams.get("start_date");
    const endDate = searchParams.get("end_date");

    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);

    const queryString = params.toString();
    const url = `https://api.anthropic.com/v1/organizations/usage_report/messages${queryString ? `?${queryString}` : ""}`;

    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
    });

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

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to fetch analytics data", details: message },
      { status: 502 },
    );
  }
}
