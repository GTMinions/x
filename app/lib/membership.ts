import "server-only";

/**
 * Has this person entered the product, or are they still being sold to?
 *
 * One predicate decides what `/` renders. Two states, and the boundary between
 * them is the only thing this file exists to keep honest:
 *
 *   A VISITOR gets the landing page — the pitch, the tiers, the CTA.
 *   A MEMBER gets the dashboard, and the landing stays reachable as
 *   "Get started" in the header so nobody loses the page that explained things.
 *
 * ── HOW SOMEBODY BECOMES A MEMBER ───────────────────────────────────────────
 * With the paywall UP, by going through checkout. Every tier does — Free is a
 * $0 subscription — so one door produces one outcome: a tier the queue can
 * order by and a card on file. The webhook writes both.
 *
 * With the paywall DOWN (an internal deployment), by clicking through the
 * landing page once. There is nothing to buy, but a first-time reader still
 * deserves the page that says what this is; after that they are working, and a
 * pitch where their dashboard should be is an obstacle.
 *
 * ── WHY `started_at` IS AN ACCOUNT COLUMN AND NOT A COOKIE ──────────────────
 * "This person has entered the product" is a fact about the person, not about
 * the browser. A cookie shows the pitch again on their phone, and again after
 * they clear it — which reads as the platform forgetting them.
 */

import { eq } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { accountUsage } from "./identity/schema";
import { isComped } from "./comps";
import { isSiteAdmin } from "./memberships";
import { paywallOn } from "./settings";
import { modeConfigured, stripeMode } from "./stripe";
import { accountTier } from "./tiers";

export type Standing = {
  member: boolean;
  /** On the guest list: pays nothing, and their wishes are built first. */
  comped?: boolean;
  /** True when the deployment is actually selling — the landing page shows
   *  tiers rather than a plain "start" button. */
  selling: boolean;
};

export async function membershipFor(accountId: number | null, email?: string | null): Promise<Standing> {
  // An invited guest is a member on sight — no checkout, no card. Asking
  // somebody you invited to enter card details is the opposite of an invitation.
  if (email && (await isComped(email))) return { member: true, selling: false, comped: true };
  // The people who run the site are in it. Sending an administrator to the
  // landing page because they never bought a tier hid the product directory
  // from the one person who registered the products.
  if (email && (await isSiteAdmin(email).catch(() => false))) return { member: true, selling: false };

  const [wall, payable] = await Promise.all([
    paywallOn().catch(() => true),
    stripeMode().then(modeConfigured).catch(() => false),
  ]);
  const selling = wall && payable;

  if (accountId === null) return { member: false, selling };

  await dbReady;
  const [row] = await db
    .select({ startedAt: accountUsage.startedAt })
    .from(accountUsage)
    .where(eq(accountUsage.accountId, accountId))
    .limit(1);

  // Clicking in is enough on its own. Subscribing also sets it (the webhook
  // does), so this one column answers the question in both worlds — the
  // alternative was two predicates that could disagree about the same person.
  if (row?.startedAt) return { member: true, selling };

  if (!selling) {
    // Nothing to buy: only the click makes a member, and they have not.
    return { member: false, selling };
  }

  // Paid deployment: a live tier with a card behind it counts even if
  // `started_at` was never written — an account subscribed before this column
  // existed is a member, and showing them a pitch would be the platform
  // forgetting a customer it is billing.
  const { tier, hasCard } = await accountTier(accountId);
  return { member: tier !== "unpriced" && tier !== "" && hasCard, selling };
}

/** Mark an account as having entered the product. Idempotent. */
export async function markStarted(accountId: number): Promise<void> {
  await dbReady;
  await db.insert(accountUsage).values({ accountId }).onConflictDoNothing();
  await db
    .update(accountUsage)
    .set({ startedAt: Math.floor(Date.now() / 1000), updatedAt: Math.floor(Date.now() / 1000) })
    .where(eq(accountUsage.accountId, accountId));
}
