import "server-only";

/**
 * Tiers, fulfilment counts, and the order the queue hands wishes to a worker.
 *
 * Tier rows live in the `tiers` table; this file carries no prices or quotas.
 * With no rows, everything resolves to UNPRICED and nothing is ordered by rank.
 */

import { and, eq, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { db, dbReady } from "./identity/db";
import { accountUsage, fulfilments, tiers as tiersTable } from "./identity/schema";

/** Open, not a union — ids are rows an operator chose. */
export type TierId = string;

export type Tier = {
  id: TierId;
  name: string;
  priceCents: number;
  /** Wishes guaranteed per period. Null means no guarantee — not zero. */
  guarantee: { perDay: number | null; perMonth: number | null };
  /** Higher goes first in the queue. */
  rank: number;
  requiresCard: boolean;
  blurb: string;
  listed: boolean;
  /** Payment-provider price ids, per mode. Null means this tier cannot be
   *  bought in that mode — the page hides the button rather than sending
   *  somebody to a checkout that 404s. */
  stripePrice: { test: string | null; live: string | null };
};

/** Used when no tier matches, and when the table is empty. */
export const UNPRICED: Tier = {
  id: "unpriced",
  name: "Unpriced",
  priceCents: 0,
  guarantee: { perDay: null, perMonth: null },
  rank: 0,
  requiresCard: false,
  blurb: "",
  listed: false,
  stripePrice: { test: null, live: null },
};

const TTL_MS = 5_000;
let cache: { at: number; rows: Tier[] } | null = null;

const rowToTier = (r: typeof tiersTable.$inferSelect): Tier => ({
  id: r.id,
  name: r.name,
  priceCents: r.priceCents,
  guarantee: { perDay: r.perDay ?? null, perMonth: r.perMonth ?? null },
  rank: r.rank,
  requiresCard: Boolean(r.requiresCard),
  blurb: r.blurb,
  listed: Boolean(r.listed),
  stripePrice: { test: r.stripePriceTest ?? null, live: r.stripePriceLive ?? null },
});

export async function listTiers(): Promise<Tier[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    await dbReady;
    const rows = (await db.select().from(tiersTable)).map(rowToTier).sort((a, b) => b.rank - a.rank);
    cache = { at: Date.now(), rows };
    return rows;
  } catch {
    // An unreachable identity DB must not stop work being built.
    return [];
  }
}

export const sellableTiers = async () => (await listTiers()).filter((t) => t.listed);

/** Unknown ids resolve to UNPRICED rather than throwing — this is on the queue
 *  path, and one stale id must not stop everybody's work. */
export async function tierById(id: string | null | undefined): Promise<Tier> {
  if (!id) return UNPRICED;
  return (await listTiers()).find((t) => t.id === id) ?? UNPRICED;
}

export async function upsertTier(t: Omit<Tier, "listed" | "stripePrice"> & { listed?: boolean; stripePrice?: Tier["stripePrice"] }, byWhom: string): Promise<void> {
  await dbReady;
  const row = {
    id: t.id.trim(),
    name: t.name.trim(),
    priceCents: Math.max(0, Math.trunc(t.priceCents)),
    perDay: t.guarantee.perDay,
    perMonth: t.guarantee.perMonth,
    rank: Math.trunc(t.rank),
    requiresCard: t.requiresCard,
    blurb: t.blurb,
    listed: t.listed ?? true,
    stripePriceTest: t.stripePrice?.test ?? null,
    stripePriceLive: t.stripePrice?.live ?? null,
    updatedAt: Math.floor(Date.now() / 1000),
    updatedBy: byWhom,
  };
  if (!row.id) throw new Error("a tier needs an id");
  await db.insert(tiersTable).values(row).onConflictDoUpdate({ target: tiersTable.id, set: row });
  cache = null;
}

export const readTier = (raw: unknown): TierId => (typeof raw === "string" ? raw.trim() : "");

export const money = (cents: number) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

export async function accountTier(accountId: number): Promise<{ tier: TierId; hasCard: boolean }> {
  await dbReady;
  const [row] = await db
    .select({ tier: accountUsage.tier, hasCard: accountUsage.hasCard })
    .from(accountUsage)
    .where(eq(accountUsage.accountId, accountId))
    .limit(1);
  // No row yet is a NEW account, not an unpriced one: it gets the free tier's
  // guarantee the moment it exists, or a signup's first wish would sort below
  // every legacy import on the board.
  return { tier: readTier(row?.tier) || "free", hasCard: Boolean(row?.hasCard) };
}

// ── fulfilment counts ───────────────────────────────────────────────────────

/** UTC, so the boundary does not move with whoever is reading. */
const dayKey = (at = new Date()) => at.toISOString().slice(0, 10);
const monthKey = (at = new Date()) => at.toISOString().slice(0, 7);

/** Keyed on the wish, so a repeated report counts once. The day is stamped at
 *  the first write, so a retry after midnight stays on the original day. */
export async function recordFulfilment(accountId: number, wishId: number, at = new Date()): Promise<void> {
  await dbReady;
  await db
    .insert(fulfilments)
    .values({ accountId, wishId, day: dayKey(at), month: monthKey(at), createdAt: Math.floor(at.getTime() / 1000) })
    .onConflictDoNothing();
}

const countWhere = async (accountId: number, col: SQLiteColumn, key: string) => {
  await dbReady;
  const [row] = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(fulfilments)
    .where(and(eq(fulfilments.accountId, accountId), eq(col, key)));
  return Number(row?.n ?? 0);
};

export const builtToday = (accountId: number, at = new Date()) =>
  countWhere(accountId, fulfilments.day, dayKey(at));
export const builtThisMonth = (accountId: number, at = new Date()) =>
  countWhere(accountId, fulfilments.month, monthKey(at));

// ── standing ────────────────────────────────────────────────────────────────

export type Standing = {
  tier: Tier;
  today: number;
  month: number;
  /** Guarantee still owed. Null when the tier guarantees nothing. */
  guaranteedLeft: number | null;
  /** Only when `perMonth` is set and reached. */
  overMonthlyCap: boolean;
};

export async function standingFor(accountId: number | null, tierId: TierId, at = new Date()): Promise<Standing> {
  const tier = await tierById(tierId);
  if (accountId === null) {
    return { tier, today: 0, month: 0, guaranteedLeft: null, overMonthlyCap: false };
  }

  const [today, month] = await Promise.all([builtToday(accountId, at), builtThisMonth(accountId, at)]);
  const g = tier.guarantee;

  const guaranteedLeft =
    g.perDay !== null
      ? Math.max(0, g.perDay - today)
      : g.perMonth !== null
        ? Math.max(0, g.perMonth - month)
        : null;

  return {
    tier,
    today,
    month,
    guaranteedLeft,
    // Only meaningful alongside a daily guarantee: for a monthly tier,
    // `guaranteedLeft` already covers exhaustion.
    overMonthlyCap: g.perDay !== null && g.perMonth !== null && month >= g.perMonth,
  };
}

// ── queue order ─────────────────────────────────────────────────────────────

/** Lower sorts first. */
export const BAND = { operator: 0, comped: 1, guaranteed: 2, spare: 3, capped: 4 } as const;
export type Band = (typeof BAND)[keyof typeof BAND];

export type Placed<T> = { wish: T; band: Band; tier: Tier; guaranteed: boolean };

/**
 * Order wishes for a worker. Returns every wish it was given — past a guarantee
 * sorts last, it is never dropped.
 *
 * THE GUEST LIST comes second, everywhere. It is small, hand-maintained, and
 * rendered in site settings, so it cannot grow by accident — which is the only
 * reason it is allowed above people who pay.
 *
 * THE OPERATOR BAND IS SCOPED TO THE PLATFORM. An operator's own wishes go
 * first only on the `site` scope, which is the platform maintaining itself.
 * The same person filing against a PRODUCT is acting as one of that product's
 * users, and their wish takes its place by the product's rules — otherwise
 * running the platform would silently outrank every paying customer inside
 * every product, which is not a rule anybody agreed to and not one the pricing
 * page could honestly describe.
 *
 * The per-account tally is in memory: several wishes from one account would
 * otherwise each read the same stored count and all look guaranteed.
 */
export async function prioritise<T extends { id: number; scope: string }>(
  ranked: T[],
  owners: Map<number, number>,
  tierOf: (accountId: number) => Promise<TierId>,
  isOperator: (accountId: number) => Promise<boolean>,
  at = new Date(),
  isComped: (accountId: number) => Promise<boolean> = async () => false,
): Promise<Placed<T>[]> {
  const seen = new Map<number, { standing: Standing; operator: boolean; comped: boolean; taken: number }>();
  const placed: Placed<T>[] = [];

  for (const wish of ranked) {
    const accountId = owners.get(wish.id);

    if (accountId === undefined) {
      // No owner means a legacy import or a CLI-minted wish — never a signed-in
      // customer, because filing records ownership. Spare, not operator: an
      // unattributed wish outranking paying customers would make "file without
      // an account" the fastest queue position on the board.
      placed.push({ wish, band: BAND.spare, tier: UNPRICED, guaranteed: false });
      continue;
    }

    let state = seen.get(accountId);
    if (!state) {
      const [tierId, operator, comped] = await Promise.all([
        tierOf(accountId),
        isOperator(accountId),
        isComped(accountId),
      ]);
      state = { standing: await standingFor(accountId, tierId, at), operator, comped, taken: 0 };
      seen.set(accountId, state);
    }

    const { standing } = state;
    if (state.operator && wish.scope === "site") {
      placed.push({ wish, band: BAND.operator, tier: standing.tier, guaranteed: true });
      continue;
    }

    // An invited guest, everywhere — including inside a product. Unlike an
    // operator's own wishes, this ordering was granted deliberately by an admin
    // who typed the address, which is what makes it defensible above paying
    // customers. It is also unmetered: a guest has no guarantee to run out of.
    if (state.comped) {
      placed.push({ wish, band: BAND.comped, tier: standing.tier, guaranteed: true });
      continue;
    }

    const left = standing.guaranteedLeft;
    const withinGuarantee = left !== null && state.taken < left && !standing.overMonthlyCap;
    state.taken += 1;

    placed.push({
      wish,
      band: standing.overMonthlyCap ? BAND.capped : withinGuarantee ? BAND.guaranteed : BAND.spare,
      tier: standing.tier,
      guaranteed: withinGuarantee,
    });
  }

  // Stable: inside a band and rank, the caller's order stands.
  return placed
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.band - b.p.band || b.p.tier.rank - a.p.tier.rank || a.i - b.i)
    .map(({ p }) => p);
}

/** The price id to check out with, in the mode currently selected. */
export const priceIdFor = (t: Tier, mode: "test" | "live") => t.stripePrice[mode];
