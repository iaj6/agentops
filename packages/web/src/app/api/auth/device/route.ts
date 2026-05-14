import { NextResponse, type NextRequest } from "next/server";
import { createDeviceCode } from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// RFC 8628 §3.2 Device Authorization Response shape.
// The CLI POSTs here (no auth needed — the device_code is itself the
// pending credential), receives a user_code to display to the human, and
// then polls /api/auth/device/token until approved.
export async function POST(req: NextRequest) {
  const code = createDeviceCode(db());

  const origin = new URL(req.url).origin;
  const expiresInSec = Math.max(
    1,
    Math.floor((new Date(code.expiresAt).getTime() - Date.now()) / 1000),
  );

  return NextResponse.json({
    device_code: code.deviceCode,
    user_code: code.userCode,
    verification_uri: `${origin}/auth/device`,
    verification_uri_complete: `${origin}/auth/device?user_code=${encodeURIComponent(code.userCode)}`,
    expires_in: expiresInSec,
    // Polling cadence the client should respect. 5s is the RFC's default.
    interval: 5,
  });
}
