import { NextResponse, type NextRequest } from "next/server";

import { isOpen, workable } from "@/app/_platform/queue";
import { listAllDbWishes } from "@/app/_platform/wishes/db";
import { roleAtLeast } from "@/app/lib/memberships";
import { wishCeilingTokens } from "@/app/lib/credits";
import { compedAmong } from "@/app/lib/comps";
import { accountTier, prioritise } from "@/app/lib/tiers";
import { emailsForAccount } from "@/app/lib/identity/accounts";
import { workerTokenValid } from "@/app/lib/worker";
import { ownersOf } from "@/app/lib/wishOwners";

/**
 * The queue, ordered for a worker.
 *
 * An endpoint rather than a CLI function because the ordering needs the identity
 * database, whose modules are `server-only`. Returns the whole ordered list, not
 * one pick — the worker still races others for the claim and needs a fallback.
 */
export async function GET(req: NextRequest) {
  if (!workerTokenValid(req.headers.get("x-worker-token"))) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  const all = await listAllDbWishes();
  if (!all) return NextResponse.json({ error: "no wish store is configured" }, { status: 503 });

  // `workable` drops trackers, unapproved wishes, and blocked ones.
  // still open. What it cannot know is who owns what — that join happens here.
  const rank = (a: (typeof all)[number], b: (typeof all)[number]) => {
    const p = (w: typeof a) => (w.priority === "p0" ? 0 : w.priority === "p1" ? 1 : w.priority === "p2" ? 2 : 3);
    return p(a) - p(b) || b.votes - a.votes || b.id - a.id;
  };
  const ranked = workable(all).sort(rank);

  // Owners are looked up for the wishes AND their parents: a split child has no
  // owner row of its own, but its place in the queue is its filer's place, and
  // the filer is recorded on the parent. Same rule the billing endpoint applies.
  const parentIds = ranked.map((w) => w.parentId).filter((id): id is number => typeof id === "number");
  const owners = await ownersOf([...ranked.map((w) => w.id), ...parentIds]);
  for (const w of ranked) {
    if (!owners.has(w.id) && typeof w.parentId === "number" && owners.has(w.parentId)) {
      owners.set(w.id, owners.get(w.parentId)!);
    }
  }

  // Cached per request: the ordering asks once per wish an account owns.
  // the same account once per wish it owns, and an account with twenty wishes
  // on the board should not cost twenty lookups.
  const tiers = new Map<number, Awaited<ReturnType<typeof accountTier>>>();
  const tierOf = async (accountId: number) => {
    let t = tiers.get(accountId);
    if (!t) tiers.set(accountId, (t = await accountTier(accountId)));
    return t.tier;
  };

  const operators = new Map<number, boolean>();
  const isOperator = async (accountId: number) => {
    const cached = operators.get(accountId);
    if (cached !== undefined) return cached;
    // Site-admin is granted by address, and an account may hold several.
    // address. Any one of them qualifying makes the person an operator.
    const emails = await emailsForAccount(accountId);
    const checks = await Promise.all(emails.map((e) => roleAtLeast(e, "site", "site", "admin")));
    const yes = checks.some(Boolean);
    operators.set(accountId, yes);
    return yes;
  };

  // Resolved in one pass: every owner's addresses, then one query against the
  // guest list. A lookup per wish would be a round trip per row on the hot path.
  const ownerIds = [...new Set(owners.values())];
  const addressOf = new Map<number, string[]>();
  await Promise.all(ownerIds.map(async (id) => addressOf.set(id, await emailsForAccount(id))));
  const guests = await compedAmong([...addressOf.values()].flat());
  const isCompedAccount = async (accountId: number) =>
    (addressOf.get(accountId) ?? []).some((e) => guests.has(e.toLowerCase()));

  const placed = await prioritise(ranked, owners, tierOf, isOperator, new Date(), isCompedAccount);

  // The runner enforces this, not the platform: only the thing watching a run
  // can stop it. The platform's job is to say what the number is, so there is
  // one place it lives rather than one per runner.
  const ceilingTokens = await wishCeilingTokens();

  return NextResponse.json({
    ceilingTokens,
    queue: placed.map(({ wish, band, tier, guaranteed }) => ({
      id: wish.id,
      scope: wish.scope,
      title: wish.title,
      band,
      tier: tier.id,
      guaranteed,
      open: isOpen(wish),
    })),
  });
}
