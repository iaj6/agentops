import { NextResponse, type NextRequest } from "next/server";
import {
  approveDeviceCode,
  denyDeviceCode,
  getDeviceCodeByUserCode,
  issueApiToken,
} from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Called by the dashboard /auth/device page when the signed-in user
// approves a device authorization. Issues a new API token tied to the
// user and links it to the device_code; the CLI polling
// /api/auth/device/token will retrieve it on the next iteration.

interface ApproveBody {
  user_code?: unknown;
  action?: unknown; // "approve" | "deny"
  name?: unknown; // user-supplied label for the issued token
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;

  let body: ApproveBody;
  try {
    body = (await req.json()) as ApproveBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body.user_code !== "string" || body.user_code.length === 0) {
    return NextResponse.json({ error: "user_code required" }, { status: 400 });
  }
  const userCode = body.user_code.trim().toUpperCase();

  const code = getDeviceCodeByUserCode(db(), userCode);
  if (!code) {
    return NextResponse.json({ error: "Unknown code" }, { status: 404 });
  }
  if (new Date(code.expiresAt).getTime() < Date.now()) {
    return NextResponse.json({ error: "Code expired" }, { status: 410 });
  }
  if (code.status !== "pending") {
    return NextResponse.json(
      { error: `Code already ${code.status}` },
      { status: 409 },
    );
  }

  const action = body.action === "deny" ? "deny" : "approve";
  if (action === "deny") {
    denyDeviceCode(db(), userCode);
    return NextResponse.json({ status: "denied" });
  }

  const tokenName =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim().slice(0, 80)
      : `device ${new Date().toISOString().slice(0, 10)}`;

  const { token, raw } = issueApiToken(db(), {
    userId: user.id,
    name: tokenName,
  });

  const ok = approveDeviceCode(db(), {
    userCode,
    userId: user.id,
    tokenId: token.id,
    rawToken: raw,
  });

  if (!ok) {
    return NextResponse.json(
      { error: "Could not approve (race or expired)" },
      { status: 409 },
    );
  }

  return NextResponse.json({ status: "approved", tokenName });
}
