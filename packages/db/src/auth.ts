import { eq, and, gt, sql } from "drizzle-orm";
import { randomBytes, scryptSync, timingSafeEqual, randomUUID, createHash } from "node:crypto";
import type { AgentOpsDb } from "./connection.js";
import { users, apiTokens, authSessions, deviceCodes } from "./schema.js";

// ─── Password hashing (scrypt, no external dep) ─────────────────────────────
//
// Stored format: scrypt$N=16384,r=8,p=1$<salt-hex>$<hash-hex>
// 16-byte salt, 64-byte hash. Constant-time compare on verify.

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const SCRYPT_PREFIX = "scrypt$N=16384,r=8,p=1$";

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return `${SCRYPT_PREFIX}${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored.startsWith(SCRYPT_PREFIX)) return false;
  const rest = stored.slice(SCRYPT_PREFIX.length);
  const [saltHex, hashHex] = rest.split("$");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const candidate = scryptSync(password, salt, expected.length, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  // Lengths are equal by construction (we just used expected.length); still
  // pad-guard timingSafeEqual which requires equal-length buffers.
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ─── Token generation / hashing ────────────────────────────────────────────
//
// Raw token format: ao_<32 random bytes base64url>. Returned to the user
// once at issue time; we persist only the SHA-256 hash.

export function generateApiToken(): { raw: string; hash: string } {
  const raw = "ao_" + randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, hash };
}

export function hashApiToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// ─── User CRUD ──────────────────────────────────────────────────────────────

export interface User {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: string;
  readonly mustChangePassword: boolean;
  readonly createdAt: string;
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string;
  role: string;
  must_change_password: number;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
  };
}

export function countUsers(db: AgentOpsDb): number {
  const result = db.all<{ c: number }>(sql`SELECT COUNT(*) as c FROM users`);
  return result[0]?.c ?? 0;
}

export function insertUser(
  db: AgentOpsDb,
  args: {
    email: string;
    name?: string;
    password: string;
    role?: "admin" | "member";
    mustChangePassword?: boolean;
  },
): User {
  const id = randomUUID();
  const passwordHash = hashPassword(args.password);
  const createdAt = new Date().toISOString();
  const role = args.role ?? (countUsers(db) === 0 ? "admin" : "member");

  db.insert(users)
    .values({
      id,
      email: args.email.toLowerCase().trim(),
      name: args.name ?? null,
      passwordHash,
      role,
      mustChangePassword: args.mustChangePassword ?? false,
      createdAt,
    })
    .run();

  return {
    id,
    email: args.email.toLowerCase().trim(),
    name: args.name ?? null,
    role,
    mustChangePassword: args.mustChangePassword ?? false,
    createdAt,
  };
}

export function getUserByEmail(db: AgentOpsDb, email: string): User | null {
  const rows = db.all<UserRow>(
    sql`SELECT * FROM users WHERE email = ${email.toLowerCase().trim()} LIMIT 1`,
  );
  return rows[0] ? rowToUser(rows[0]) : null;
}

export function getUserById(db: AgentOpsDb, id: string): User | null {
  const rows = db.all<UserRow>(sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`);
  return rows[0] ? rowToUser(rows[0]) : null;
}

export function getUserWithPasswordByEmail(
  db: AgentOpsDb,
  email: string,
): { user: User; passwordHash: string } | null {
  const rows = db.all<UserRow>(
    sql`SELECT * FROM users WHERE email = ${email.toLowerCase().trim()} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return { user: rowToUser(row), passwordHash: row.password_hash };
}

export function listUsers(db: AgentOpsDb): User[] {
  const rows = db.all<UserRow>(sql`SELECT * FROM users ORDER BY created_at ASC`);
  return rows.map(rowToUser);
}

export function setUserPassword(
  db: AgentOpsDb,
  userId: string,
  newPassword: string,
): void {
  db.update(users)
    .set({
      passwordHash: hashPassword(newPassword),
      mustChangePassword: false,
    })
    .where(eq(users.id, userId))
    .run();
}

// ─── API tokens (CLI/SDK bearer tokens) ─────────────────────────────────────

export interface ApiToken {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
}

export function issueApiToken(
  db: AgentOpsDb,
  args: { userId: string; name: string; expiresAt?: string },
): { token: ApiToken; raw: string } {
  const { raw, hash } = generateApiToken();
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  db.insert(apiTokens)
    .values({
      id,
      tokenHash: hash,
      userId: args.userId,
      name: args.name,
      createdAt,
      lastUsedAt: null,
      expiresAt: args.expiresAt ?? null,
    })
    .run();

  return {
    token: {
      id,
      userId: args.userId,
      name: args.name,
      createdAt,
      lastUsedAt: null,
      expiresAt: args.expiresAt ?? null,
    },
    raw,
  };
}

export function getUserByRawApiToken(db: AgentOpsDb, raw: string): User | null {
  const hash = hashApiToken(raw);
  const rows = db.all<{ user_id: string; expires_at: string | null; token_id: string }>(
    sql`SELECT id as token_id, user_id, expires_at FROM api_tokens WHERE token_hash = ${hash} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  // Update last_used_at; best-effort.
  db.update(apiTokens)
    .set({ lastUsedAt: new Date().toISOString() })
    .where(eq(apiTokens.id, row.token_id))
    .run();
  return getUserById(db, row.user_id);
}

export function listApiTokensForUser(db: AgentOpsDb, userId: string): ApiToken[] {
  const rows = db.all<{
    id: string;
    user_id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  }>(
    sql`SELECT id, user_id, name, created_at, last_used_at, expires_at
        FROM api_tokens WHERE user_id = ${userId}
        ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  }));
}

export function revokeApiToken(db: AgentOpsDb, tokenId: string): void {
  db.delete(apiTokens).where(eq(apiTokens.id, tokenId)).run();
}

export function listAllApiTokens(db: AgentOpsDb): ApiToken[] {
  const rows = db.all<{
    id: string;
    user_id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  }>(
    sql`SELECT id, user_id, name, created_at, last_used_at, expires_at
        FROM api_tokens
        ORDER BY created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  }));
}

export function getApiTokenById(db: AgentOpsDb, tokenId: string): ApiToken | null {
  const rows = db.all<{
    id: string;
    user_id: string;
    name: string;
    created_at: string;
    last_used_at: string | null;
    expires_at: string | null;
  }>(
    sql`SELECT id, user_id, name, created_at, last_used_at, expires_at
        FROM api_tokens WHERE id = ${tokenId} LIMIT 1`,
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    expiresAt: r.expires_at,
  };
}

// ─── Browser sessions (cookie) ─────────────────────────────────────────────

export interface AuthSession {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function createAuthSession(db: AgentOpsDb, userId: string): AuthSession {
  const id = "as_" + randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);

  db.insert(authSessions)
    .values({
      id,
      userId,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .run();

  return {
    id,
    userId,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

export function getUserBySessionId(db: AgentOpsDb, sessionId: string): User | null {
  const rows = db.all<{ user_id: string; expires_at: string }>(
    sql`SELECT user_id, expires_at FROM auth_sessions WHERE id = ${sessionId} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return null;
  }
  return getUserById(db, row.user_id);
}

export function deleteAuthSession(db: AgentOpsDb, sessionId: string): void {
  db.delete(authSessions).where(eq(authSessions.id, sessionId)).run();
}

export function deleteExpiredAuthSessions(db: AgentOpsDb): number {
  const result = db
    .delete(authSessions)
    .where(sql`expires_at < ${new Date().toISOString()}`)
    .run();
  return result.changes;
}

// ─── Device authorization grant codes ──────────────────────────────────────

export interface DeviceCode {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly status: "pending" | "approved" | "denied" | "expired" | "consumed";
  readonly userId: string | null;
  readonly tokenId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly approvedAt: string | null;
}

const DEVICE_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes
// User-facing short code: 8 chars from a confusable-pruned alphabet,
// formatted XXXX-XXXX. Roughly 10^11 possibilities — plenty for a 15-minute
// window with rate-limited approvals.
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

function generateUserCode(): string {
  const chars = [];
  for (let i = 0; i < 8; i++) {
    const idx = randomBytes(1)[0]! % USER_CODE_ALPHABET.length;
    chars.push(USER_CODE_ALPHABET[idx]);
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function createDeviceCode(db: AgentOpsDb): DeviceCode {
  const deviceCode = "dc_" + randomBytes(32).toString("base64url");
  const userCode = generateUserCode();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + DEVICE_CODE_TTL_MS);

  db.insert(deviceCodes)
    .values({
      deviceCode,
      userCode,
      status: "pending",
      userId: null,
      tokenId: null,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      approvedAt: null,
    })
    .run();

  return {
    deviceCode,
    userCode,
    status: "pending",
    userId: null,
    tokenId: null,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    approvedAt: null,
  };
}

interface DeviceCodeRow {
  device_code: string;
  user_code: string;
  status: string;
  user_id: string | null;
  token_id: string | null;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
}

function rowToDeviceCode(row: DeviceCodeRow): DeviceCode {
  return {
    deviceCode: row.device_code,
    userCode: row.user_code,
    status: row.status as DeviceCode["status"],
    userId: row.user_id,
    tokenId: row.token_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
  };
}

export function getDeviceCodeByUserCode(
  db: AgentOpsDb,
  userCode: string,
): DeviceCode | null {
  const rows = db.all<DeviceCodeRow>(
    sql`SELECT * FROM device_codes WHERE user_code = ${userCode.toUpperCase()} LIMIT 1`,
  );
  return rows[0] ? rowToDeviceCode(rows[0]) : null;
}

export function getDeviceCodeByDeviceCode(
  db: AgentOpsDb,
  deviceCode: string,
): DeviceCode | null {
  const rows = db.all<DeviceCodeRow>(
    sql`SELECT * FROM device_codes WHERE device_code = ${deviceCode} LIMIT 1`,
  );
  return rows[0] ? rowToDeviceCode(rows[0]) : null;
}

export function approveDeviceCode(
  db: AgentOpsDb,
  args: { userCode: string; userId: string; tokenId: string; rawToken?: string },
): boolean {
  const result = db
    .update(deviceCodes)
    .set({
      status: "approved",
      userId: args.userId,
      tokenId: args.tokenId,
      pendingRawToken: args.rawToken ?? null,
      approvedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(deviceCodes.userCode, args.userCode.toUpperCase()),
        eq(deviceCodes.status, "pending"),
        gt(deviceCodes.expiresAt, new Date().toISOString()),
      ),
    )
    .run();
  return result.changes > 0;
}

/**
 * Atomically retrieve the pending raw token for an approved device code and
 * clear it from the row. Returns null if the code does not exist, is not
 * approved, has already been consumed, or has expired.
 */
export function consumeApprovedDeviceCode(
  db: AgentOpsDb,
  deviceCode: string,
): { rawToken: string; userId: string } | null {
  const rows = db.all<{
    pending_raw_token: string | null;
    user_id: string | null;
    status: string;
    expires_at: string;
  }>(
    sql`SELECT pending_raw_token, user_id, status, expires_at
        FROM device_codes WHERE device_code = ${deviceCode} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  if (row.status !== "approved" || !row.pending_raw_token || !row.user_id) {
    return null;
  }
  const update = db
    .update(deviceCodes)
    .set({ status: "consumed", pendingRawToken: null })
    .where(
      and(
        eq(deviceCodes.deviceCode, deviceCode),
        eq(deviceCodes.status, "approved"),
      ),
    )
    .run();
  if (update.changes === 0) return null;
  return { rawToken: row.pending_raw_token, userId: row.user_id };
}

export function denyDeviceCode(db: AgentOpsDb, userCode: string): boolean {
  const result = db
    .update(deviceCodes)
    .set({ status: "denied" })
    .where(
      and(
        eq(deviceCodes.userCode, userCode.toUpperCase()),
        eq(deviceCodes.status, "pending"),
      ),
    )
    .run();
  return result.changes > 0;
}

export function deleteExpiredDeviceCodes(db: AgentOpsDb): number {
  const result = db
    .delete(deviceCodes)
    .where(sql`expires_at < ${new Date().toISOString()}`)
    .run();
  return result.changes;
}
