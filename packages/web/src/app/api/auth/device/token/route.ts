import { NextResponse, type NextRequest } from "next/server";
import {
  getDeviceCodeByDeviceCode,
  consumeApprovedDeviceCode,
} from "@agentops/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

// RFC 8628 §3.4 Device Access Token Request.
// The CLI polls this endpoint with the device_code it received from
// /api/auth/device. Returns the access token on first successful poll
// after the user has approved (single-use), or one of the well-known
// OAuth error codes otherwise.

interface TokenBody {
  grant_type?: unknown;
  device_code?: unknown;
}

function oauthError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

export async function POST(req: NextRequest) {
  let body: TokenBody;
  try {
    body = (await req.json()) as TokenBody;
  } catch {
    return oauthError("invalid_request");
  }

  if (typeof body.grant_type !== "string") {
    return oauthError("invalid_request");
  }
  if (body.grant_type !== "urn:ietf:params:oauth:grant-type:device_code") {
    return oauthError("unsupported_grant_type");
  }
  if (typeof body.device_code !== "string" || body.device_code.length === 0) {
    return oauthError("invalid_request");
  }

  const code = getDeviceCodeByDeviceCode(db(), body.device_code);
  if (!code) return oauthError("invalid_grant");
  if (new Date(code.expiresAt).getTime() < Date.now()) {
    return oauthError("expired_token");
  }
  if (code.status === "denied") return oauthError("access_denied");
  if (code.status === "pending") return oauthError("authorization_pending");
  if (code.status === "consumed") {
    // Already retrieved by an earlier successful poll.
    return oauthError("invalid_grant");
  }
  if (code.status !== "approved") return oauthError("invalid_grant");

  const consumed = consumeApprovedDeviceCode(db(), body.device_code);
  if (!consumed) {
    // Lost a race with another concurrent poll, or the row was tampered.
    return oauthError("invalid_grant");
  }

  return NextResponse.json({
    access_token: consumed.rawToken,
    token_type: "Bearer",
  });
}
