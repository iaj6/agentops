import { NextResponse, type NextRequest } from "next/server";
import {
  getUserWithPasswordByEmail,
  verifyPassword,
  setUserPassword,
} from "@agentops/db";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface ChangePasswordBody {
  currentPassword?: unknown;
  newPassword?: unknown;
}

export async function POST(req: NextRequest) {
  const user = await requireUser(req);
  if (user instanceof NextResponse) return user;

  let body: ChangePasswordBody;
  try {
    body = (await req.json()) as ChangePasswordBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (
    typeof body.currentPassword !== "string" ||
    typeof body.newPassword !== "string"
  ) {
    return NextResponse.json(
      { error: "currentPassword and newPassword required" },
      { status: 400 },
    );
  }

  if (body.newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  // Re-look up by email so we have the password hash.
  const found = getUserWithPasswordByEmail(db(), user.email);
  if (!found) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (!verifyPassword(body.currentPassword, found.passwordHash)) {
    return NextResponse.json(
      { error: "Current password is incorrect" },
      { status: 401 },
    );
  }
  if (body.currentPassword === body.newPassword) {
    return NextResponse.json(
      { error: "New password must be different" },
      { status: 400 },
    );
  }

  setUserPassword(db(), user.id, body.newPassword);
  return NextResponse.json({ status: "ok" });
}
