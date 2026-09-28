import "server-only";

// Refresh-token sessions in the shared `sessions` table. Ported from
// the accounts service's sessions module; single-use rotating refresh tokens.

import { createHash, randomBytes } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db, dbReady } from "./db";
import { sessions } from "./schema";

const REFRESH_TTL = Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 30 * 86400);
const sessionId = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 16);

function hashRefresh(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export interface IssuedSession {
  sessionId: string;
  refreshToken: string;
  expiresAt: number;
}

export async function issueSession(input: {
  accountId: number;
  userAgent?: string;
  ip?: string;
}): Promise<IssuedSession> {
  await dbReady;
  const id = sessionId();
  const refreshToken = `srfr_${randomBytes(32).toString("hex")}`;
  const expiresAt = Math.floor(Date.now() / 1000) + REFRESH_TTL;
  await db.insert(sessions).values({
    id,
    accountId: input.accountId,
    refreshTokenHash: hashRefresh(refreshToken),
    userAgent: input.userAgent,
    ip: input.ip,
    expiresAt,
  });
  return { sessionId: id, refreshToken, expiresAt };
}

export async function rotateSession(refreshToken: string): Promise<{
  accountId: number;
  newRefresh: IssuedSession;
} | null> {
  await dbReady;
  const hashed = hashRefresh(refreshToken);
  const now = Math.floor(Date.now() / 1000);
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.refreshTokenHash, hashed), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row || row.expiresAt < now) return null;

  await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.id));
  const fresh = await issueSession({
    accountId: row.accountId,
    userAgent: row.userAgent ?? undefined,
    ip: row.ip ?? undefined,
  });
  return { accountId: row.accountId, newRefresh: fresh };
}

export async function revokeSession(refreshToken: string): Promise<void> {
  await dbReady;
  const hashed = hashRefresh(refreshToken);
  await db
    .update(sessions)
    .set({ revokedAt: Math.floor(Date.now() / 1000) })
    .where(eq(sessions.refreshTokenHash, hashed));
}
