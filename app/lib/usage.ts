import "server-only";

/**
 * What an account has used: byte storage, and the rolled-up token totals.
 *
 * Build capacity is a credit balance (`./credits.ts`). Rows read are not
 * metered — a board render reads on behalf of whoever loaded the page, so it
 * cannot honestly be charged to one account.
 */

import { eq, sql } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { accountUsage } from "./identity/schema";

// ── the free tier ───────────────────────────────────────────────────────────

/** Attachments and wish bodies. */
export const FREE_BYTES = Number(process.env.FREE_TIER_BYTES) || 50_000_000;

export type Usage = {
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  bytes: number;
  wishesFiled: number;
};

const EMPTY: Usage = {
  tokens: 0, tokensIn: 0, tokensOut: 0, bytes: 0,
  wishesFiled: 0,
};

export async function usageFor(accountId: number): Promise<Usage> {
  await dbReady;
  const rows = await db.select().from(accountUsage).where(eq(accountUsage.accountId, accountId)).limit(1);
  const r = rows[0];
  if (!r) return EMPTY;
  return {
    tokens: r.tokensIn + r.tokensOut,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    bytes: r.bytesStored,
    wishesFiled: r.wishesFiled,
  };
}

// ── the verdict ─────────────────────────────────────────────────────────────

export type Allowance = {
  ok: boolean;
  usage: Usage;
  bytes: { used: number; limit: number; pct: number };
  /** Set when `ok` is false — the sentence to show the person. */
  reason?: string;
};

const pct = (used: number, limit: number) => (limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100)));

/**
 * The one thing still gated at filing time: storage.
 *
 * Build capacity is NOT checked here any more. Rationing moved to the queue —
 * a tier guarantees builds per day and overflow waits — so a person can always
 * ask; the credit balance gates nothing until pay-per-use ships. Storage is
 * different in kind: bytes sit on disk whether or not the wish is ever built,
 * so they are refused at the door.
 */
export async function allowanceFor(accountId: number | null, isAdmin = false): Promise<Allowance> {
  const usage = accountId === null ? EMPTY : await usageFor(accountId);
  const bytes = { used: usage.bytes, limit: FREE_BYTES, pct: pct(usage.bytes, FREE_BYTES) };

  if (isAdmin) return { ok: true, usage, bytes };

  const mb = (n: number) => `${Math.round(n / 1e6)} MB`;
  if (usage.bytes >= FREE_BYTES) {
    return {
      ok: false, usage, bytes,
      reason:
        `Your attachments and wish bodies come to ${mb(usage.bytes)}, which is the whole ` +
        `${mb(FREE_BYTES)} an account may store. Delete some attachments to free room. ` +
        "Storage is not something you can top up yet — say so if you need more and it will be raised.",
    };
  }

  return { ok: true, usage, bytes };
}

// ── recording ───────────────────────────────────────────────────────────────

/** Create the row on first touch, so every `add` below can assume one exists. */
async function ensure(accountId: number): Promise<void> {
  await dbReady;
  await db.insert(accountUsage).values({ accountId }).onConflictDoNothing();
}

/** Count an attachment against the account that uploaded it. */
export async function recordBytes(accountId: number, bytes: number): Promise<void> {
  if (!Number.isFinite(bytes) || bytes <= 0) return;
  await ensure(accountId);
  await db
    .update(accountUsage)
    .set({
      bytesStored: sql`${accountUsage.bytesStored} + ${Math.floor(bytes)}`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(accountUsage.accountId, accountId));
}

/** Filing is free; this is the denominator that makes the token total legible. */
export async function recordWishFiled(accountId: number): Promise<void> {
  await ensure(accountId);
  await db
    .update(accountUsage)
    .set({
      wishesFiled: sql`${accountUsage.wishesFiled} + 1`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(accountUsage.accountId, accountId));
}

/** Re-exported rather than reimplemented — one writer for the balance. */
export { addCredits } from "./credits";
