import "server-only";

/**
 * Credit balances, and the token→credit conversion.
 *
 * NOT WIRED INTO ANY GATE TODAY, deliberately. The live model is subscription
 * tiers (`./tiers.ts`): a tier guarantees builds per day, overflow queues, and
 * nothing meters filing. Credits are the pay-per-use layer that arrives later —
 * the schema, the balance arithmetic, and the tests are kept ready, but no
 * route consults `canFile` and `recordSpend` charges nothing. Wiring a balance
 * gate in *while* tiers are live would double-ration the same wish: a paying
 * subscriber whose opening grant ran out would be refused filing that their
 * subscription already covers.
 *
 * The balance is held in CREDITS, not tokens: the ratio is operator-tunable, and
 * storing tokens would revalue balances people already own every time it moved.
 * Every charge records the ratio it used, so a receipt survives a change.
 *
 * The three numbers live in the settings table, not here.
 */

import { eq, sql } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { accountUsage } from "./identity/schema";
import { getSetting, setSetting } from "./settings";

/** Placeholders, not a calibration — set these from `wishCostStats()` once a
 *  deployment has shipped enough wishes to have its own median. */
const DEFAULTS = {
  "credit.tokens": "12000000",
  "credit.grant": "3",
  "credit.wishCeilingTokens": "30000000",
} as const;

export type SettingKey = keyof typeof DEFAULTS;

const num = async (key: SettingKey): Promise<number> => {
  const raw = await getSetting(key, DEFAULTS[key]);
  const n = Number(raw);
  // A malformed row must not zero the ratio — it is a divisor.
  return Number.isFinite(n) && n > 0 ? n : Number(DEFAULTS[key]);
};

export const tokensPerCredit = () => num("credit.tokens");
export const grantCredits = () => num("credit.grant");
/** Per-wish token ceiling a worker enforces. */
export const wishCeilingTokens = () => num("credit.wishCeilingTokens");

export async function creditSettings() {
  const keys = Object.keys(DEFAULTS) as SettingKey[];
  return Promise.all(keys.map(async (key) => ({ key, value: await num(key), fallback: Number(DEFAULTS[key]) })));
}

export async function setCreditSetting(key: SettingKey, value: number, byWhom: string): Promise<void> {
  if (!(key in DEFAULTS)) throw new Error(`unknown setting ${key}`);
  if (!Number.isFinite(value) || value <= 0) throw new Error("must be a positive number");
  await setSetting(key, String(Math.trunc(value)), byWhom);
}

// ── balance ─────────────────────────────────────────────────────────────────

export type Balance = {
  /** Bought outright, plus the opening grant. */
  purchased: number;
  spent: number;
  /** Floored at zero; see `owed`. */
  remaining: number;
  /** How far past zero. A charge lands at ship time, when the cost is finally
   *  known, so it can arrive after the balance was already thin. */
  owed: number;
};

const EMPTY: Balance = { purchased: 0, spent: 0, remaining: 0, owed: 0 };

export async function balanceFor(accountId: number | null): Promise<Balance> {
  if (accountId === null) return EMPTY;
  await dbReady;
  const [row] = await db.select().from(accountUsage).where(eq(accountUsage.accountId, accountId)).limit(1);

  // The opening grant applies before the first write, so a new account with no
  // row still shows a balance.
  const grant = await grantCredits();
  const purchased = (row?.creditsPurchased ?? 0) + grant;
  const spent = row?.creditsSpent ?? 0;
  const left = purchased - spent;
  return { purchased, spent, remaining: Math.max(0, left), owed: Math.max(0, -left) };
}

/** Checked when a wish is filed. */
export async function canFile(accountId: number | null, isAdmin = false): Promise<
  { ok: true; balance: Balance } | { ok: false; balance: Balance; reason: string }
> {
  const balance = await balanceFor(accountId);
  if (isAdmin || accountId === null) return { ok: true, balance };
  if (balance.remaining > 0) return { ok: true, balance };

  const s = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;
  return {
    ok: false,
    balance,
    reason: balance.owed
      ? `Your last wish cost ${s(balance.owed)} more than you had left. Top up to keep building — ` +
        "credits are bought outright, nothing recurring, and they do not expire."
      : `You have used all ${s(balance.purchased)} on your account. Top up to keep building — ` +
        "credits are bought outright, nothing recurring, and they do not expire.",
  };
}

// ── moving credits ──────────────────────────────────────────────────────────

/** Purchases, refunds of money, and manual grants. */
export async function addCredits(accountId: number, credits: number): Promise<void> {
  const n = Math.trunc(credits);
  if (!Number.isFinite(n) || n === 0) return;
  await dbReady;
  await db.insert(accountUsage).values({ accountId }).onConflictDoNothing();
  await db
    .update(accountUsage)
    .set({
      creditsPurchased: sql`MAX(0, ${accountUsage.creditsPurchased} + ${n})`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(accountUsage.accountId, accountId));
}

/** Rounds up, and never charges zero for a run that did work. */
export function creditsForTokens(tokens: number, ratio: number): number {
  if (!(tokens > 0)) return 0;
  return Math.max(1, Math.ceil(tokens / ratio));
}

/** Returns the ratio used as well as the amount — the caller writes both onto
 *  the ledger row so the receipt stays reconstructible. */
export async function chargeTokens(accountId: number, tokens: number): Promise<{ credits: number; ratio: number }> {
  const ratio = await tokensPerCredit();
  const credits = creditsForTokens(tokens, ratio);
  if (!credits) return { credits: 0, ratio };

  await dbReady;
  await db.insert(accountUsage).values({ accountId }).onConflictDoNothing();
  await db
    .update(accountUsage)
    .set({
      creditsSpent: sql`${accountUsage.creditsSpent} + ${credits}`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(accountUsage.accountId, accountId));

  return { credits, ratio };
}

/** Reverses a charge. Subtracts from spent rather than adding to purchased, so
 *  the history matches the ledger. */
export async function refundCharge(accountId: number, credits: number): Promise<void> {
  const n = Math.trunc(credits);
  if (!Number.isFinite(n) || n <= 0) return;
  await dbReady;
  await db
    .update(accountUsage)
    .set({
      creditsSpent: sql`MAX(0, ${accountUsage.creditsSpent} - ${n})`,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(accountUsage.accountId, accountId));
}
