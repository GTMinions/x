/**
 * Wish ids: global, random, and free to mint.
 *
 * WHY NOT AUTOINCREMENT
 * Wishes live in one database per product, so a per-database counter gives you
 * a `#4` in `gtm` and a different `#4` in `ai-edu`. Every link and every
 * `pnpm wishes --claim 4` would then need a scope beside it to mean anything,
 * and an id that only works when you also say where it lives is a row number,
 * not an id.
 *
 * WHY NOT "RANDOM, THEN CHECK EVERY DATABASE"
 * That was the first version of this file and it was wrong on cost. Verifying a
 * random draw against every product meant, on each wish created:
 *
 *     COUNT(*) × products      (to pick how many digits to draw)
 *   + SELECT 1  × products     (to prove the draw was free)
 *   + INSERT
 *
 * — nine network round trips to Turso with four products, growing with every
 * product added, to write one row. All of it to defend against a collision
 * that a cheaper design makes impossible.
 *
 * WHAT THIS DOES INSTEAD: PARTITION, DON'T COORDINATE
 * Give each product a block of the id space and draw at random inside it:
 *
 *     id = block × 100_000 + random(0 … 99_999)
 *
 * Two products now hold disjoint ranges, so a cross-product collision cannot
 * happen — not "is unlikely", cannot. The only collision left possible is two
 * wishes in the SAME product drawing the same number, and `id INTEGER PRIMARY
 * KEY` already rejects that at insert with no extra query. So the cost is:
 *
 *     INSERT                   (one round trip; a rare retry on the rare clash)
 *
 * Uniqueness stops being something we verify and becomes something the layout
 * guarantees. Nothing is scanned, and adding a fifth product does not make
 * filing a wish slower.
 *
 * WHAT IT COSTS
 * The leading digits name the product — `#204213` is a gtm wish. That is not a
 * secret worth keeping (a wish's scope is on the wish, and anyone who can read
 * the id can read the wish) and it makes an id easier to place at a glance.
 *
 * Blocks are assigned here, explicitly, and never reused. Deriving one from a
 * hash of the slug would look tidier and would silently move a product's whole
 * id range the day someone renamed it.
 */

import { randomInt } from "node:crypto";

/** Slots per product. 100k is comfortable for this project's lifetime: the
 *  retry below only starts costing anything above a few thousand wishes in one
 *  product, and `BLOCK` can be widened later without invalidating any existing
 *  id, since old ids stay inside their old block. */
const BLOCK = 100_000;

/**
 * Product → id block. Append-only: a number here is a permanent claim on a
 * range of ids, and reusing one would let a new product mint an id an old wish
 * already holds.
 *
 * `site` is a product like any other and takes the first block. A product with
 * no entry gets `UNASSIGNED`, which is a loud shared block rather than a crash
 * — see `blockFor`.
 */
export const WISH_ID_BLOCKS: Record<string, number> = {
  site: 1,
  "ai-edu": 2, // retired 2026-09-26; the number stays claimed (append-only)
  devmentor: 3, // retired 2026-09-26
  gtm: 4, // retired 2026-09-26
  "inference-economics": 5,
};

/**
 * The block a product with no assignment lands in.
 *
 * Sharing one block across every unregistered product is deliberate: it keeps
 * a newly-registered product working before anyone edits this file, and it
 * keeps its ids inside a range no assigned product will ever use. It is not a
 * good permanent home — two unregistered products share it, so the PRIMARY KEY
 * is doing all the work — which is why `unassignedScopes` exists to fail a
 * check in CI.
 */
const UNASSIGNED = 99;

/** Ids below this belong to wishes imported from GitHub, which keep their
 *  original issue number. Block 1 starts at 100000, so an imported wish and a
 *  generated one can never claim the same id. */
export const WISH_ID_FLOOR = BLOCK;

/**
 * `extra` is the registry's assignments — products created at runtime get a
 * block there (app/lib/registry/core.ts `wishBlocks()`), since a code table
 * cannot know a product that did not exist when it was written.
 */
export function blockFor(scope: string, extra: Record<string, number> = {}): number {
  return WISH_ID_BLOCKS[scope] ?? extra[scope] ?? UNASSIGNED;
}

/** Which of these scopes have no block of their own. Used by
 *  `scripts/validate-content.ts` so a product added without an id block is
 *  caught in CI rather than discovered when two of them collide. */
export function unassignedScopes(scopes: string[], extra: Record<string, number> = {}): string[] {
  return scopes.filter((s) => !(s in WISH_ID_BLOCKS) && !(s in extra));
}

/**
 * One candidate id for this product.
 *
 * `randomInt` is the CSPRNG rather than `Math.random` — not because an id is a
 * secret, but because a guessable id paired with any future id-only endpoint is
 * a hole nobody would remember to come back and close.
 */
export function mintWishId(scope: string, extra: Record<string, number> = {}): number {
  return blockFor(scope, extra) * BLOCK + randomInt(0, BLOCK);
}

/** The range a product's ids fall in — for tests, and for reading an id back
 *  to a product without a lookup. */
export function blockRange(scope: string, extra: Record<string, number> = {}): { min: number; max: number } {
  const b = blockFor(scope, extra);
  return { min: b * BLOCK, max: b * BLOCK + BLOCK - 1 };
}

/** Which product an id belongs to, or null for an imported wish (below the
 *  floor) or an unrecognised block. A hint for logs and error messages — the
 *  authoritative answer is which database the row is actually in. */
export function scopeOfId(id: number, extra: Record<string, number> = {}): string | null {
  if (id < WISH_ID_FLOOR) return null;
  const block = Math.floor(id / BLOCK);
  const all = { ...extra, ...WISH_ID_BLOCKS };
  return Object.keys(all).find((s) => all[s] === block) ?? null;
}

/** How many times to redraw before giving up. Each retry is one rejected
 *  INSERT, and at a few thousand wishes in a block the odds of needing even one
 *  are a couple of percent — so six is far past "unlucky" and firmly in
 *  "something else is wrong". */
export const MINT_ATTEMPTS = 6;
