import "server-only";

/**
 * Who may file straight into the queue, and whose wish waits for a person.
 *
 * THE RULE
 * A wish that only touches something you administer is approved the moment you
 * file it. Anything else waits for an admin of the thing it touches.
 *
 * That is a question about PERMISSION, and it replaces one about WORDING. The
 * old gate read the request — body over 600 characters, four or more bullets, a
 * keyword out of a list — and decided from that whether a human should look
 * first. It did not sort wishes by how risky they were; it sorted them by how
 * they were typed. It once refused the wish asking for its own removal, because
 * the word "approval" appeared in that wish's title.
 *
 * The new question has an answer that does not depend on phrasing and cannot be
 * gamed by rewording: *does this person already have the authority to make this
 * change themselves?* If they do, routing their request through a reviewer is
 * ceremony — they could merge it by hand. If they do not, no rewrite should let
 * them in, and none can.
 *
 * WHY ADMIN AND NOT EDITOR
 * `editor` can change a product's content; `admin` decides what the product is
 * for. Approving a wish is a claim on the queue's time and on what ships next,
 * which is the second kind of decision. It is also the level the existing
 * approve/reject route already required, so this adds no new concept — it makes
 * one rule out of two that agreed anyway.
 *
 * WHY A TEAM ADMIN COUNTS
 * `roleAtLeast` does not cascade team → product on its own (only site admin is
 * global). Without the team check, the admin of the team that OWNS a product
 * could not approve a wish against it, which is the same lockout
 * `app/lib/access.ts` had to solve for reading.
 *
 * WHAT THIS DOES NOT DECIDE
 * Whether the wish is filed in the right place at all. `governProductWish`
 * still refuses a product wish that names the platform or another product, and
 * it refuses at filing time whoever is asking — a misfile is not something an
 * admin should be able to wave through, because the wish is real and simply
 * belongs on another board.
 */

import { getProduct, listProducts } from "./products";
import { roleAtLeast } from "./memberships";

/** `site` is a scope like any other, and its admin is the site admin. */
function scopeKind(scope: string): { type: "site" | "product"; id: string } {
  return scope === "site" ? { type: "site", id: "site" } : { type: "product", id: scope };
}

/**
 * May this person approve wishes against this scope — and therefore file into
 * it without review?
 *
 * A site admin passes everywhere: `roleAtLeast` short-circuits on that, and it
 * is the honest answer, since a site admin can already act on any board.
 */
export async function canApproveScope(email: string | null | undefined, scope: string): Promise<boolean> {
  if (!email) return false;

  const { type, id } = scopeKind(scope);
  if (await roleAtLeast(email, type, id, "admin")) return true;

  // The owning team's admin. Checked second because it is the rarer case and
  // costs a second lookup.
  const product = type === "product" ? await getProduct(scope) : null;
  if (product?.teamSlug && (await roleAtLeast(email, "team", product.teamSlug, "admin"))) return true;

  return false;
}

/**
 * Does a wish this person files against this scope need a human first?
 *
 * The inverse of the above, named separately because that is how the calling
 * code reads at the point of use — and because a boolean called
 * `!canApproveScope` in the middle of a filing route is one `!` away from
 * approving everything.
 */
export async function wishNeedsApproval(email: string | null | undefined, scope: string): Promise<boolean> {
  return !(await canApproveScope(email, scope));
}

/**
 * Every scope whose pending wishes this person is responsible for.
 *
 * This is what the review page lists. An empty array is a normal answer — most
 * people administer nothing — and the page says so rather than 404ing, because
 * the route existing is not a secret and a person who was just granted a role
 * should not be told the page is missing.
 */
export async function approvableScopes(email: string | null | undefined): Promise<string[]> {
  if (!email) return [];
  const scopes = ["site", ...(await listProducts()).map((p) => p.slug)];
  const verdicts = await Promise.all(scopes.map((s) => canApproveScope(email, s)));
  return scopes.filter((_, i) => verdicts[i]);
}
