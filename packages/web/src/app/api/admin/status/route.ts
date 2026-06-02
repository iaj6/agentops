import { NextResponse, type NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = await requireAdmin(request);
  if (user instanceof NextResponse) return user;

  const configured = !!process.env.ANTHROPIC_ADMIN_API_KEY;
  return NextResponse.json({ configured });
}
