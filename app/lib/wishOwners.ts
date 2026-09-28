import "server-only";

/**
 * The private half of a wish: who filed it, and therefore whose balance it spends.
 *
 * A wish row carries a display name, not an account. This table answers the two
 * questions that needs, without putting identity into four product databases:
 *
 *   ownership — "whose wishes are these?" A display name is not unique and a
 *               user can change theirs, so two people called `guest` would
 *               share a history and a rename would orphan one.
 *   billing   — "who is charged when this ships?" The meter needs an account,
 *               and the run only knows a wish number.
 *
 * Missing rows are normal, not an error: every wish filed before this table
 * existed has none, and so does anything imported from the old issue tracker.
 * A wish with no owner is simply not charged to anyone.
 */

import { eq, inArray } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { wishOwners } from "./identity/schema";

/** Record the filer at creation time. Idempotent per wish id. */
export async function recordOwner(wishId: number, accountId: number): Promise<void> {
  await dbReady;
  try {
    await db.insert(wishOwners).values({ wishId, accountId }).onConflictDoNothing();
  } catch (err) {
    // The wish already exists at this point, and the user is looking at it.
    // Losing this row means the run that builds it is never charged — bad, and
    // recoverable; throwing here would instead lose the response to a wish that
    // was in fact created.
    console.error("[wish-owners] could not record owner for wish", wishId, err);
  }
}

/** Every wish id this account filed. The quota then counts how many of those
 *  are still open, which is a question only the wish store can answer. */
export async function wishIdsFor(accountId: number): Promise<number[]> {
  await dbReady;
  const rows = await db.select({ wishId: wishOwners.wishId }).from(wishOwners).where(eq(wishOwners.accountId, accountId));
  return rows.map((r) => r.wishId);
}

/** Who filed this wish, if we know. This is the join the usage meter makes at
 *  ship time, so a run can report spend against a wish without ever naming — or
 *  being able to name — an account. */
export async function ownerOf(wishId: number): Promise<{ accountId: number } | null> {
  await dbReady;
  const rows = await db.select().from(wishOwners).where(eq(wishOwners.wishId, wishId)).limit(1);
  const row = rows[0];
  return row ? { accountId: row.accountId } : null;
}

/** Bulk lookup, so a board does not issue one query per row. */
export async function ownersOf(wishIds: number[]): Promise<Map<number, number>> {
  if (!wishIds.length) return new Map();
  await dbReady;
  const rows = await db.select().from(wishOwners).where(inArray(wishOwners.wishId, wishIds));
  return new Map(rows.map((r) => [r.wishId, r.accountId]));
}
