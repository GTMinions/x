import { NextResponse, type NextRequest } from "next/server";
import { listWishes, listAllWishes, addWish, blockWish, governProductWish, wishStore, type Role, type Media } from "@/app/_platform/wishes";
import { WISH_FILE_RATE, WISH_FILE_WINDOW_MS, WISHES_PENDING_MAX, isOpen } from "@/app/_platform/queue";
import { getSession, displayName } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { roleAtLeast } from "@/app/lib/platform";
import { clientIp, hit } from "@/app/lib/rateLimit";
import { recordOwner, wishIdsFor } from "@/app/lib/wishOwners";
import { isComped } from "@/app/lib/comps";
import { paywallOn } from "@/app/lib/settings";
import { modeConfigured, stripeMode } from "@/app/lib/stripe";
import { accountTier, tierById } from "@/app/lib/tiers";
import { allowanceFor, recordWishFiled } from "@/app/lib/usage";
import { canReadProduct, readableScopes, siteWishFilter } from "@/app/lib/access";
import { canApproveScope, wishNeedsApproval } from "@/app/lib/approval";
import { WishPolicyError, listAllDbWishes } from "@/app/_platform/wishes/db";
import { listProducts } from "@/app/lib/products";

/**
 * GET /api/wishes?scope=<slug|all> — one board, or every board for the site page.
 * `isAdmin` is what the board uses to decide whether to offer the admin controls;
 * it is not what decides whether they work. That is re-checked on every write.
 *
 * ACCESS
 * A wish says what someone wants and what a product is missing, so a board is
 * product data and is filtered like the product itself. `scope=all` was the
 * single worst leak on the site: one request returned every product's wishes to
 * anybody signed in, no matter whose product it was.
 */
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") || "site";
  const session = await getSession();
  const email = session?.email;

  // Same predicate the write route enforces and the review queue lists by, so
  // the controls a board offers and the ones that work cannot drift apart.
  // `all` is the site board's cross-scope view, so it asks about the site.
  const isAdmin = await canApproveScope(email, scope === "all" ? "site" : scope);

  /**
   * `site` is in every reader's allowed set, so scope alone never gated the
   * platform board. `siteWishFilter` is the second pass that does.
   */
  const mine = await ownWishIds(email);
  const visible = await siteWishFilter(email, mine);

  if (scope === "all") {
    // Filter rather than refuse: the cross-scope board is useful to everyone,
    // it just may not show more than the reader could reach one product at a
    // time. `site` is always in the allowed set.
    const allowed = new Set(await readableScopes(email));
    const wishes = (await listAllWishes()).filter((w) => allowed.has(w.scope)).filter(visible);
    return NextResponse.json({ store: wishStore(), wishes, isAdmin, scopes: [...allowed] });
  }

  if (scope !== "site" && !(await canReadProduct(email, scope))) {
    return NextResponse.json(
      { error: `"${scope}" is private. Ask a site admin for a grant on it, or on the team that owns it.` },
      { status: 403 },
    );
  }

  return NextResponse.json({ store: wishStore(), wishes: (await listWishes(scope)).filter(visible), isAdmin });
}

/** The wish ids this reader filed — the "you may always see your own" half of
 *  the site-wish rule. An empty set for a signed-out reader, who has none. */
async function ownWishIds(email: string | null | undefined): Promise<Set<number>> {
  if (!email) return new Set();
  const account = await findAccountByEmail(email);
  return account ? new Set(await wishIdsFor(account.id)) : new Set();
}

/** POST /api/wishes — create a wish (with media, governance, policy-driven approval). */
export async function POST(req: NextRequest) {
  const session = await getSession();
  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const scope = String(payload.scope || "").trim();
  const title = String(payload.title || "").trim();
  const body = typeof payload.body === "string" ? payload.body : "";
  if (!scope || !title) return NextResponse.json({ error: "scope and title required" }, { status: 400 });

  // You cannot file against a product you cannot read. Otherwise a wish is a
  // write into a private product's database by someone with no grant on it —
  // and the confirmation would tell them the product is real and reachable.
  if (scope !== "site" && !(await canReadProduct(session?.email, scope))) {
    return NextResponse.json(
      { error: `"${scope}" is private. Ask for a grant on it before filing wishes there.` },
      { status: 403 },
    );
  }

  /**
   * Governance: a product wish that reaches outside its product.
   *
   * Naming another product is refused — that half belongs on a board the filer
   * may not be able to read. Needing a platform change is SPLIT instead, below,
   * once we know the wish is otherwise allowed to be filed.
   */
  const otherSlugs = (await listProducts()).map((p) => p.slug).filter((s) => s !== scope);
  const gov = governProductWish(scope, title, body, otherSlugs);
  if (gov.verdict === "refuse") return NextResponse.json({ error: gov.reason }, { status: 422 });

  const media: Media[] = Array.isArray(payload.media)
    ? (payload.media as unknown[]).filter((m): m is Media => !!m && typeof (m as Media).url === "string").slice(0, 4)
    : [];

  const nickname = session ? displayName(session) : "guest";

  /**
   * The two limits, in the order they matter.
   *
   * What is limited here is almost nothing. The daily build RATE is enforced by
   * the queue, because a limit that refuses the thought makes a person decide
   * whether an idea is worth a slot at the moment they know least; filing stays
   * open and the wish simply waits its turn.
   *
   * The one exception is a ceiling on wishes held OPEN at once. It bounds how
   * much of a shared board one account occupies, which is a cost everybody
   * carries whether or not those wishes are ever worked. It counts open wishes
   * only — a hundred SHIPPED wishes is a good customer, not a problem.
   *
   * What remains is a flood valve, keyed per account and falling back to IP for
   * a filer we cannot name. It is deliberately loose: it exists to stop a
   * script, not to shape a tier.
   */
  const account = session?.email ? await findAccountByEmail(session.email) : null;
  const isAdmin = await roleAtLeast(session?.email, "site", "site", "admin");

  /**
   * Running the platform is not a rank inside somebody's product.
   *
   * A site admin filing against a PRODUCT is one of that product's users for as
   * long as that wish exists, and the product's rules apply to them: the board
   * they occupy is shared, the queue orders them by tier, and the governance
   * check never looked at who was asking in the first place. The exemptions
   * below are for the SITE scope — the platform maintaining itself, where the
   * operator is the only person there is.
   *
   * The one exemption that survives everywhere is the card: it exists to make a
   * SECOND account cost something, and the operator is not an abuse vector —
   * gating them on it would let a payments misconfiguration lock the owner out
   * of their own deployment.
   */
  const actingAsOperator = isAdmin && scope === "site";

  /**
   * The open-wish ceiling, checked at FILING time.
   *
   * Deliberately here and not when a wish is built: a person should learn they
   * are out of room at the moment they ask, not have a wish silently accepted
   * and then never worked.
   */
  if (account && !actingAsOperator) {
    // The only thing rationed at FILING time. The daily build rate is enforced
    // by the queue, not here — a limit that refuses the thought makes a person
    // decide whether an idea is worth a slot at the moment they know least. This
    // one is different in kind: it bounds how much of the board one account can
    // occupy, which is a cost the whole platform carries.
    // Intersected with the board on purpose. `wishIdsFor` returns every wish the
    // account ever filed, so counting it directly would lock out the heaviest
    // USER — somebody whose hundredth wish shipped months ago — which is the
    // exact opposite of what a pending cap is for.
    const mine = new Set(await wishIdsFor(account.id));
    const board = (await listAllDbWishes()) ?? [];
    const open = board.filter((w) => mine.has(w.id) && isOpen(w)).length;
    if (open >= WISHES_PENDING_MAX) {
      return NextResponse.json(
        {
          error:
            `You have ${open} wishes open, which is the most one account may hold at once. ` +
            "They are not lost — this only pauses new ones until some of them are built or closed.",
        },
        { status: 429 },
      );
    }
  }

  if (account) {
    // Bytes sit on disk whoever uploaded them, so this follows the same rule:
    // exempt while maintaining the platform, counted inside a product.
    const allowance = await allowanceFor(account.id, actingAsOperator);
    if (!allowance.ok) {
      return NextResponse.json(
        { error: allowance.reason, usage: allowance.usage, bytes: allowance.bytes },
        { status: 402 },
      );
    }
  }

  /**
   * The paywall: a wish needs a subscription, even the free one.
   *
   * Every tier goes through checkout — Free is a $0 subscription — so that one
   * door produces one outcome: an account with a card on file and a tier the
   * queue can order by. A free tier that skipped the door would need a second
   * way to acquire a tier and a second way to acquire a card, and the two would
   * drift.
   *
   * Three things switch it off, each for a different reason:
   *  · `paywallOn()` is false — the operator turned it off for an internal
   *    deployment, where a checkout in front of your own colleagues is ceremony.
   *  · Payments are not configured — there is no door to walk through, and a
   *    gate nobody can pass is not a gate, it is an outage.
   *  · The person is maintaining the platform itself (`actingAsOperator`).
   */
  if (account && !actingAsOperator) {
    const [wall, payable, guest] = await Promise.all([
      paywallOn(),
      stripeMode().then(modeConfigured),
      isComped(session?.email),
    ]);
    // The guest list is the fourth thing that stands the wall down, and the
    // only one that is about a person rather than the deployment.
    if (wall && payable && !guest) {
      const { tier: tierId, hasCard } = await accountTier(account.id);
      const tier = await tierById(tierId);
      // `subscribed` and `hasCard` answer the same question from two sides: a
      // completed checkout sets the card, and a live subscription sets the
      // tier. Either is proof the door was walked through.
      const subscribed = tier.id !== "unpriced" && hasCard;
      if (!subscribed) {
        return NextResponse.json(
          {
            error:
              "Pick a plan before filing. Free is $0 and stays free — it goes through checkout so " +
              "every account arrives the same way, with a card on file that is never charged there.",
            paywall: true,
          },
          { status: 402 },
        );
      }
    }
  }

  if (!actingAsOperator) {
    const bucket = account ? `wish:acct:${account.id}` : `wish:ip:${clientIp(req)}`;
    const flood = hit(bucket, WISH_FILE_RATE, WISH_FILE_WINDOW_MS);
    if (!flood.ok) {
      return NextResponse.json(
        {
          error:
            `That is ${WISH_FILE_RATE} wishes in an hour, which is faster than this is meant to be used. ` +
            `Try again in ${flood.retryAfter}s. There is no limit on how many wishes you may have open; ` +
            "this only stops a script.",
        },
        { status: 429, headers: { "retry-after": String(flood.retryAfter) } },
      );
    }
  }

  /**
   * Approval, by permission rather than by phrasing.
   *
   * If you administer what this wish touches, it is approved the moment you
   * file it — routing it past a reviewer would be ceremony, since you could
   * make the change yourself. Everyone else waits for an admin of that scope,
   * and no rewording changes the answer. A signed-out filer always waits.
   */
  const needsApproval = await wishNeedsApproval(session?.email, scope);

  let wish;
  try {
    wish = await addWish({
      scope, title, body, media, needsApproval,
      role: (["PM", "UX", "Eng"].includes(String(payload.role)) ? payload.role : undefined) as Role | undefined,
      nickname,
      source: payload.source === "design-mode" ? "design-mode" : payload.source === "split" ? "split" : payload.source === "roadmap" ? "roadmap" : "form",
    });
  } catch (err) {
    // A cap breach is an answer, not a crash. 507 rather than 429: the limit is
    // storage the product has already used, not a rate the filer can wait out.
    if (err instanceof WishPolicyError) {
      return NextResponse.json({ error: err.message }, { status: 507 });
    }
    throw err;
  }
  if (account) {
    await recordOwner(wish.id, account.id);
    await recordWishFiled(account.id);
  }

  /**
   * The split: the platform half, filed on the site board, with the product
   * half made to wait on it.
   *
   * Order matters — the product wish is created first because the site wish
   * quotes its number, and the block is written last because it needs both.
   * The site half is never auto-approved: its filer is (by definition here) not
   * a site admin, so the ordinary approval rule parks it in triage and it shows
   * up in a site admin's review queue. No special case.
   *
   * Every step after the product wish is best-effort. The product wish already
   * exists and the filer is looking at it; losing the platform half costs them
   * a follow-up, while throwing here would lose a wish that was in fact created.
   */
  let split: { site: number; reason: string } | null = null;
  if (gov.verdict === "split") {
    try {
      const siteWish = await addWish({
        scope: "site",
        title,
        body:
          `${body}\n\n---\nSplit out of #${wish.id} (${scope}), because ${gov.reason}. ` +
          `That wish is waiting on this one.`,
        media,
        nickname,
        source: "split",
        // What makes this half visible to the product's readers rather than to
        // the site admins alone.
        originScope: scope,
        needsApproval: await wishNeedsApproval(session?.email, "site"),
      });
      await blockWish(wish.id, siteWish.id, nickname);
      if (account) {
        await recordOwner(siteWish.id, account.id);
        await recordWishFiled(account.id);
      }
      split = { site: siteWish.id, reason: gov.reason };
    } catch (err) {
      console.error("[wishes] could not file the platform half of a split", err);
    }
  }

  return NextResponse.json(
    { ok: true, wish, needsApproval: wish.needsApproval, ...(split ? { split } : {}) },
    { status: 201 },
  );
}
