import "server-only";

/**
 * Email sign-in codes, owned by this app.
 *
 * This logic used to live on a separate accounts service and be reached over HTTP. It
 * moved here so the project stands alone; the storage is unchanged (`otp_codes`
 * in the identity DB), so a deployment pointed at an existing accounts database
 * keeps working against the same rows.
 *
 * The properties worth stating, because each one is a way this goes wrong:
 *
 *   - The code is stored **hashed**. A leaked DB read should not be a sign-in.
 *   - Verifying is **constant-time**, so response timing does not reveal a
 *     prefix.
 *   - Attempts are **counted and capped**, so a 6-digit code cannot be walked.
 *   - A code is **single-use** — consumed on success, and every other outstanding
 *     code for that address is consumed with it.
 *   - Requests are **rate-limited per address**, because this endpoint sends mail
 *     to anyone the caller names and is therefore a way to use x to bother a
 *     stranger.
 */

import { createHash, randomInt, timingSafeEqual } from "crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { db, dbReady } from "./db";
import { otpCodes } from "./schema";

const CODE_TTL_SECONDS = Number(process.env.OTP_TTL_SECONDS ?? 600); // 10 minutes
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);
/** How many codes one address may request inside the TTL window. */
const MAX_SENDS_PER_WINDOW = Number(process.env.OTP_MAX_SENDS ?? 5);

const now = () => Math.floor(Date.now() / 1000);
const hash = (code: string) => createHash("sha256").update(code).digest("hex");

/** A 6-digit code from a CSPRNG. `Math.random()` is not acceptable here. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface IssuedCode {
  code: string;
  expiresAt: number;
}

/**
 * Create and store a code for `email`. Returns null when the address has asked
 * too many times in the current window — the caller should still answer as if it
 * succeeded, so the endpoint does not become an oracle for which addresses are
 * being targeted.
 */
export async function issueEmailCode(email: string): Promise<IssuedCode | null> {
  await dbReady;
  const target = email.trim().toLowerCase();
  const t = now();

  const recent = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.channel, "email"),
        eq(otpCodes.target, target),
        gt(otpCodes.createdAt, t - CODE_TTL_SECONDS),
      ),
    );
  if (recent.length >= MAX_SENDS_PER_WINDOW) return null;

  const code = generateCode();
  const expiresAt = t + CODE_TTL_SECONDS;
  await db.insert(otpCodes).values({
    channel: "email",
    target,
    codeHash: hash(code),
    expiresAt,
  });
  return { code, expiresAt };
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "no-code" | "expired" | "too-many-attempts" | "mismatch" };

/**
 * Check `code` against the newest unconsumed code for `email`.
 *
 * Only the newest is considered: if a person asks for three codes, the third is
 * the one in front of them, and accepting the first would keep a shoulder-surfed
 * older code alive.
 */
export async function verifyEmailCode(email: string, code: string): Promise<VerifyResult> {
  await dbReady;
  const target = email.trim().toLowerCase();
  const t = now();

  const [row] = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.channel, "email"),
        eq(otpCodes.target, target),
        isNull(otpCodes.consumedAt),
      ),
    )
    .orderBy(desc(otpCodes.id))
    .limit(1);

  if (!row) return { ok: false, reason: "no-code" };
  if (row.expiresAt < t) return { ok: false, reason: "expired" };
  if (row.attempts >= MAX_ATTEMPTS) {
    // Burn it: a code that has been guessed at this much is not worth keeping.
    await db.update(otpCodes).set({ consumedAt: t }).where(eq(otpCodes.id, row.id));
    return { ok: false, reason: "too-many-attempts" };
  }

  if (!constantTimeEqual(row.codeHash, hash(code.trim()))) {
    await db
      .update(otpCodes)
      .set({ attempts: row.attempts + 1 })
      .where(eq(otpCodes.id, row.id));
    return { ok: false, reason: "mismatch" };
  }

  // Success consumes every outstanding code for the address, not just this one,
  // so a previously-emailed code cannot be replayed afterwards.
  await db
    .update(otpCodes)
    .set({ consumedAt: t })
    .where(
      and(
        eq(otpCodes.channel, "email"),
        eq(otpCodes.target, target),
        isNull(otpCodes.consumedAt),
      ),
    );
  return { ok: true };
}

/** The email a person actually receives. */
export function codeEmail(code: string): { subject: string; text: string; html: string } {
  const mins = Math.round(CODE_TTL_SECONDS / 60);
  return {
    subject: `${code} is your sign-in code`,
    text: `Your sign-in code is ${code}. It expires in ${mins} minutes.\n\nIf you did not ask for this, you can ignore this email — nobody can sign in without the code.`,
    html:
      `<p style="font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">Your sign-in code is</p>` +
      `<p style="font:600 32px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;margin:16px 0">${code}</p>` +
      `<p style="font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#666">It expires in ${mins} minutes. If you did not ask for this, ignore this email — nobody can sign in without the code.</p>`,
  };
}
