import "server-only";

/**
 * Who may read which product.
 *
 * THE PROBLEM THIS FIXES
 * `visibility` has been a field on `Product` since the registry was written and
 * nothing has ever read it. `listProducts()` even carried the tell —
 * `filter((p) => p.visibility !== "unlisted" || true)`, a predicate that is
 * `true` in every case. So every signed-in user could open every product, and
 * the site-wide wish board showed every product's wishes to everyone.
 *
 * THE MODEL
 * Two questions, deliberately kept apart, because conflating them is how a
 * product ends up either unlinked-but-readable or listed-but-403:
 *
 *   read    — may this person open the product at all?
 *   listing — should it appear in the directory they are shown?
 *
 * `unlisted` is exactly the case that needs both: readable by anyone with the
 * link, absent from the directory. Folding it into one boolean would lose that.
 *
 * WHAT THIS IS NOT
 * It is not secrecy about a product's EXISTENCE. The codebase is open source, so
 * every slug, route and component is public knowledge by design — a reader can
 * see that `inference-economics` exists by looking at the repository. What is protected is
 * the product's DATA: its research corpus, its wishes, its workspace. That is
 * the same line the per-product databases draw, and this module is the
 * application-side half of it.
 *
 * Being honest about that shapes the refusal: a denied product says "you do not
 * have access" rather than pretending to be a 404. A fake 404 would protect
 * nothing a `git clone` does not already reveal, and would leave a legitimate
 * user who simply needs a grant staring at a dead end.
 */

import { getProduct, listProducts, type Product } from "./products";
import { roleAtLeast } from "./memberships";

/**
 * May this person open this product?
 *
 * `public` is a real answer, not a fallthrough: the demo exists to be read by
 * anyone who signs in, and requiring a grant for it would mean hand-granting
 * every visitor.
 *
 * For anything else, three ways in — a grant on the product, a grant on the
 * owning team, or site admin. The team check matters because `roleAtLeast` does
 * NOT cascade team → product on its own (only site admin is global), so without
 * it the owners of a product would be locked out of their own work.
 */
export async function canReadProduct(email: string | null | undefined, slug: string): Promise<boolean> {
  const product = await getProduct(slug);
  if (!product) return false;

  // Signing in is still required — `proxy.ts` gates the whole app — but a
  // public product asks nothing beyond that.
  if (product.visibility === "public" || product.visibility === "unlisted") return true;

  if (!email) return false;
  if (await roleAtLeast(email, "product", slug, "reader")) return true;
  if (await roleAtLeast(email, "team", product.teamSlug, "reader")) return true;
  return false;
}

/** Why a product was refused, in words a page can render. Separate from the
 *  boolean so the shell does not have to reconstruct the reason. */
export type Denial = { reason: "unknown" | "private"; product: Product | null };

export async function readProductOrDenial(
  email: string | null | undefined,
  slug: string,
): Promise<{ ok: true; product: Product } | { ok: false } & Denial> {
  const product = await getProduct(slug);
  if (!product) return { ok: false, reason: "unknown", product: null };
  if (await canReadProduct(email, slug)) return { ok: true, product };
  return { ok: false, reason: "private", product };
}

/**
 * The products to show this person in a directory.
 *
 * `unlisted` is readable but deliberately absent unless the reader has a grant
 * — that is the whole meaning of the value, and a directory that showed it
 * would make it a synonym for `public`.
 */
export async function listableProducts(email: string | null | undefined): Promise<Product[]> {
  const decided = await Promise.all(
    (await listProducts()).map(async (p) => {
      if (p.visibility === "public") return p;
      // Both `private` and `unlisted` need a grant to be LISTED, even though
      // only `private` needs one to be read.
      return (await canReadProductAsMember(email, p)) ? p : null;
    }),
  );
  return decided.filter((p): p is Product => p !== null);
}

/** Membership-only check, ignoring visibility. Used by listing, where a public
 *  product is already in and the question is whether a non-public one has a
 *  grant behind it. */
async function canReadProductAsMember(email: string | null | undefined, p: Product): Promise<boolean> {
  if (!email) return false;
  return (
    (await roleAtLeast(email, "product", p.slug, "reader")) ||
    (await roleAtLeast(email, "team", p.teamSlug, "reader"))
  );
}

/**
 * Every scope this person may read, including `site`.
 *
 * The site-wide wish board is the caller that most needs this: it reads across
 * products by design, and without a filter it was the one surface that showed
 * everybody everything. `site` is always included — the platform's own wishes
 * are common ground, and the wish form is the way a user asks for anything at
 * all, including access.
 */
export async function readableScopes(email: string | null | undefined): Promise<string[]> {
  const products = await Promise.all(
    (await listProducts()).map(async (p) => ((await canReadProduct(email, p.slug)) ? p.slug : null)),
  );
  return ["site", ...products.filter((s): s is string => s !== null)];
}

/**
 * Which SITE wishes a person may read.
 *
 * Site wishes used to be world-readable to anyone signed in — `readableScopes`
 * always includes `site`, so one request returned every platform ask on the
 * board, including work in progress on the spine itself. A product's wishes
 * were gated from the day `visibility` started being enforced; the platform's
 * were not, which was backwards: the platform is the one thing every product
 * inherits.
 *
 * Four ways in, and only four:
 *
 *   1. You administer the site. You already act on that board.
 *   2. You filed it. Your own ask is never hidden from you — the alternative is
 *      a wish you cannot follow, which is worse than not filing it.
 *   3. It was split out of a product wish, and you can read that product. The
 *      platform half of someone's ask is that product's business.
 *   4. A site admin marked it public. This is what keeps the site board from
 *      going dark for a newcomer: the door is shut, the window is a choice.
 *
 * Returns a predicate rather than filtering a list, because the two callers differ —
 * one has a list, one has a single wish, and both must agree.
 */
export async function siteWishFilter(
  email: string | null | undefined,
  ownWishIds: ReadonlySet<number>,
): Promise<(w: { id: number; scope: string; originScope?: string; publicWish?: boolean }) => boolean> {
  const admin = await roleAtLeast(email, "site", "site", "admin");
  if (admin) return () => true;

  // Resolve product readability once — a board render must not turn into one
  // membership lookup per wish.
  const readable = new Set(await readableScopes(email));

  return (w) => {
    if (w.scope !== "site") return true; // other scopes are gated by their own product
    if (ownWishIds.has(w.id)) return true;
    if (w.publicWish) return true;
    if (w.originScope && readable.has(w.originScope)) return true;
    return false;
  };
}
