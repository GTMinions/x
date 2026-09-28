import "server-only";

/**
 * Worker registry and the token ledger.
 *
 * Liveness is derived from `last_seen_at` rather than stored: a process that
 * dies cannot write "offline". The ledger keeps the four token kinds apart
 * because cache reads dominate the count and cost a fraction of the rate.
 */

import { desc, eq, inArray, sql } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { accountEmails, accountUsage, tokenLedger, workers } from "./identity/schema";

// ── the registry ────────────────────────────────────────────────────────────

/** How recently a worker must have been heard from to count as alive. There is
 *  no heartbeat: `last_seen_at` is touched by registering, shipping, reporting. */
export const WORKER_ALIVE_SECONDS = Number(process.env.WORKER_ALIVE_SECONDS) || 5 * 60;

export type WorkerRow = {
  id: string;
  label: string | null;
  registeredAt: number;
  lastSeenAt: number;
  alive: boolean;
};

/** Upsert: a restarted worker keeps its id so it can re-take its own lease. */
export async function registerWorker(id: string, label?: string): Promise<void> {
  await dbReady;
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(workers)
    .values({ id, label: label ?? null, registeredAt: now, lastSeenAt: now })
    .onConflictDoUpdate({
      target: workers.id,
      // appeared, which is worth knowing after a restart loop.
      set: { lastSeenAt: now, ...(label ? { label } : {}) },
    });
}

export async function listWorkers(): Promise<WorkerRow[]> {
  await dbReady;
  const cutoff = Math.floor(Date.now() / 1000) - WORKER_ALIVE_SECONDS;
  const rows = await db.select().from(workers).orderBy(desc(workers.lastSeenAt));
  return rows.map((r) => ({
    id: r.id,
    label: r.label ?? null,
    registeredAt: r.registeredAt,
    lastSeenAt: r.lastSeenAt,
    alive: r.lastSeenAt >= cutoff,
  }));
}

// ── the ledger ──────────────────────────────────────────────────────────────

export type Spend = {
  accountId: number;
  wishId?: number | null;
  scope?: string | null;
  workerId?: string | null;
  model?: string | null;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  outputTokens?: number;
  listCostCents?: number | null;
  /**
   * Stable across retries of the same spend, different for a new one.
   * `${wishId}:${runId}` is the natural choice.
   */
  idempotencyKey: string;
};

/** Does this error, or anything it wraps, mean "that row is already there"? */
function isUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 6; depth++) {
    const text = `${(e as Error)?.message ?? ""} ${(e as { code?: string })?.code ?? ""}`;
    if (/unique|constraint/i.test(text)) return true;
    e = (e as { cause?: unknown })?.cause;
  }
  return false;
}

/**
 * Record a spend, once. A duplicate returns `recorded: false` — the expected
 * result of a retry, not an error. The rolled-up totals on `account_usage` are
 * a cache of the ledger, kept because the balance is read on every filing.
 */
export async function recordSpend(s: Spend): Promise<{ recorded: boolean }> {
  await dbReady;

  const input = Math.max(0, Math.trunc(s.inputTokens ?? 0));
  const cacheRead = Math.max(0, Math.trunc(s.cacheReadTokens ?? 0));
  const cacheWrite = Math.max(0, Math.trunc(s.cacheWriteTokens ?? 0));
  const output = Math.max(0, Math.trunc(s.outputTokens ?? 0));

  // `credits_charged` stays 0 while the live model is subscription tiers —
  // fulfilment is what tiers meter, and charging a balance nobody is required
  // to hold would strand every account at "owed". When pay-per-use arrives,
  // `chargeTokens` is called here and the row carries the rate it used.
  try {
    await db.insert(tokenLedger).values({
      accountId: s.accountId,
      creditsCharged: 0,
      tokensPerCredit: null,
      wishId: s.wishId ?? null,
      scope: s.scope ?? null,
      workerId: s.workerId ?? null,
      model: s.model ?? null,
      inputTokens: input,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      outputTokens: output,
      listCostCents: s.listCostCents ?? null,
      idempotencyKey: s.idempotencyKey,
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { recorded: false };
    throw err;
  }

  await db.insert(accountUsage).values({ accountId: s.accountId }).onConflictDoNothing();
  await db
    .update(accountUsage)
    .set({
      // meter measures work done. What each KIND cost is a question for the
      // ledger, which keeps them apart.
      tokensIn: sql`${accountUsage.tokensIn} + ${input + cacheRead + cacheWrite}`,
      tokensOut: sql`${accountUsage.tokensOut} + ${output}`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(accountUsage.accountId, s.accountId));

  return { recorded: true };
}

export type AccountSpend = {
  accountId: number;
  email: string | null;
  tier: string;
  runs: number;
  freshIn: number;
  cacheRead: number;
  out: number;
  creditsPurchased: number;
  creditsSpent: number;
};

/**
 * Spend per account, heaviest first — the admin's "who is costing what".
 *
 * Grouped in the database, then joined to addresses and balances in one pass
 * each: three bounded queries, not one per account. The email is what makes the
 * table legible; an account id is a number nobody can act on.
 */
export async function spendByAccount(limit = 20): Promise<AccountSpend[]> {
  await dbReady;
  const grouped = await db
    .select({
      accountId: tokenLedger.accountId,
      runs: sql<number>`COUNT(*)`,
      freshIn: sql<number>`SUM(${tokenLedger.inputTokens} + ${tokenLedger.cacheWriteTokens})`,
      cacheRead: sql<number>`SUM(${tokenLedger.cacheReadTokens})`,
      out: sql<number>`SUM(${tokenLedger.outputTokens})`,
    })
    .from(tokenLedger)
    .groupBy(tokenLedger.accountId)
    .orderBy(desc(sql`SUM(${tokenLedger.inputTokens} + ${tokenLedger.cacheWriteTokens} + ${tokenLedger.outputTokens})`))
    .limit(limit);
  if (!grouped.length) return [];

  const ids = grouped.map((g) => g.accountId);
  const [emails, usage] = await Promise.all([
    db.select().from(accountEmails).where(inArray(accountEmails.accountId, ids)),
    db.select().from(accountUsage).where(inArray(accountUsage.accountId, ids)),
  ]);
  const emailOf = new Map<number, string>();
  for (const e of emails) if (!emailOf.has(e.accountId)) emailOf.set(e.accountId, e.email);
  const usageOf = new Map(usage.map((u) => [u.accountId, u]));

  return grouped.map((g) => ({
    accountId: g.accountId,
    email: emailOf.get(g.accountId) ?? null,
    tier: usageOf.get(g.accountId)?.tier ?? "free",
    runs: Number(g.runs),
    freshIn: Number(g.freshIn ?? 0),
    cacheRead: Number(g.cacheRead ?? 0),
    out: Number(g.out ?? 0),
    creditsPurchased: usageOf.get(g.accountId)?.creditsPurchased ?? 0,
    creditsSpent: usageOf.get(g.accountId)?.creditsSpent ?? 0,
  }));
}

/** Addresses for a set of accounts — the billing feed shows people, not ids. */
export async function emailsFor(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  await dbReady;
  const rows = await db.select().from(accountEmails).where(inArray(accountEmails.accountId, [...new Set(ids)]));
  const out = new Map<number, string>();
  for (const r of rows) if (!out.has(r.accountId)) out.set(r.accountId, r.email);
  return out;
}

/** The newest spend across every account — the admin surface's feed. */
export async function ledgerRecent(limit = 30) {
  await dbReady;
  return db.select().from(tokenLedger).orderBy(desc(tokenLedger.createdAt), desc(tokenLedger.id)).limit(limit);
}

/** One account's spend, newest first. */
export async function ledgerFor(accountId: number, limit = 50) {
  await dbReady;
  return db
    .select()
    .from(tokenLedger)
    .where(eq(tokenLedger.accountId, accountId))
    .orderBy(desc(tokenLedger.createdAt))
    .limit(limit);
}

/** Everything spent on one wish — more than one row if it was retried. */
export async function ledgerForWish(wishId: number) {
  await dbReady;
  return db.select().from(tokenLedger).where(eq(tokenLedger.wishId, wishId)).orderBy(tokenLedger.createdAt);
}

/** What a wish costs, measured. Reports the sample count alongside, because a
 *  figure from two runs is an anecdote. */
export async function wishCostStats(): Promise<{
  samples: number;
  medianTokens: number;
  meanTokens: number;
  p90Tokens: number;
  medianCents: number | null;
} | null> {
  await dbReady;
  const rows = await db
    .select({
      wishId: tokenLedger.wishId,
      total: sql<number>`SUM(${tokenLedger.inputTokens} + ${tokenLedger.cacheReadTokens} + ${tokenLedger.cacheWriteTokens} + ${tokenLedger.outputTokens})`,
      cents: sql<number>`SUM(COALESCE(${tokenLedger.listCostCents}, 0))`,
    })
    .from(tokenLedger)
    .where(sql`${tokenLedger.wishId} IS NOT NULL`)
    .groupBy(tokenLedger.wishId);

  if (!rows.length) return null;

  const totals = rows.map((r) => Number(r.total)).sort((a, b) => a - b);
  const cents = rows.map((r) => Number(r.cents)).filter((c) => c > 0).sort((a, b) => a - b);
  const at = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]!;

  return {
    samples: rows.length,
    medianTokens: at(totals, 0.5),
    meanTokens: Math.round(totals.reduce((a, b) => a + b, 0) / totals.length),
    p90Tokens: at(totals, 0.9),
    medianCents: cents.length ? at(cents, 0.5) : null,
  };
}
