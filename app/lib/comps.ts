import "server-only";

/**
 * The guest list: accounts that pay nothing and are built first.
 *
 * Design partners, the people who found the bugs, a demo running tomorrow. Two
 * effects, and they are separate on purpose:
 *
 *   NO PAYWALL. A comped address is a member the moment it signs in, without a
 *   checkout and without a card. This is not "we gave them the free tier" — the
 *   free tier still goes through a $0 checkout, and asking an invited guest to
 *   enter card details is the opposite of an invitation.
 *
 *   FIRST IN THE QUEUE. Their wishes sort above every paying customer, below
 *   only the operator's own platform work. That ordering is a deliberate act by
 *   an admin who typed an address, which is what makes it different from an
 *   operator's own wishes quietly outranking customers inside a product.
 *
 * ── WHY THIS IS SAFE TO PUT ABOVE PAYING CUSTOMERS ──────────────────────────
 * Because it is small, explicit, and visible. It is a list an admin maintains
 * by hand with a note beside each row; it is rendered in site settings; and it
 * cannot grow by accident, because nothing writes to it except that form.
 * A silent, derived, or self-serve version of this would be a different feature
 * and a much worse one.
 *
 * ── EMAIL, NOT ACCOUNT ID ───────────────────────────────────────────────────
 * You invite somebody before they sign in. A table keyed on account ids cannot
 * hold an invitation, only a record of one already accepted.
 */

import { desc, eq, inArray } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { comps } from "./identity/schema";

export type Comp = {
  email: string;
  note: string | null;
  grantedBy: string | null;
  createdAt: number;
};

const norm = (email: string) => email.trim().toLowerCase();

export async function listComps(): Promise<Comp[]> {
  try {
    await dbReady;
    const rows = await db.select().from(comps).orderBy(desc(comps.createdAt));
    return rows.map((r) => ({ email: r.email, note: r.note ?? null, grantedBy: r.grantedBy ?? null, createdAt: r.createdAt }));
  } catch {
    // An unreachable identity DB must not take the settings page down; it just
    // shows an empty list, and nobody is comped until it answers again.
    return [];
  }
}

export async function isComped(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    await dbReady;
    const [row] = await db.select({ email: comps.email }).from(comps).where(eq(comps.email, norm(email))).limit(1);
    return Boolean(row);
  } catch {
    // Fails CLOSED: an unreachable table must not hand out free top-priority
    // access. The worst case is a guest waiting like everybody else.
    return false;
  }
}

/** Which of these accounts are comped, in one query. The queue asks about a
 *  page of wishes at once and must not pay a round trip per owner. */
export async function compedAmong(emails: string[]): Promise<Set<string>> {
  const wanted = [...new Set(emails.map(norm).filter(Boolean))];
  if (!wanted.length) return new Set();
  try {
    await dbReady;
    const rows = await db.select({ email: comps.email }).from(comps).where(inArray(comps.email, wanted));
    return new Set(rows.map((r) => r.email));
  } catch {
    return new Set();
  }
}

export async function addComp(email: string, note: string | null, byWhom: string): Promise<void> {
  const e = norm(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("that is not an email address");
  await dbReady;
  await db
    .insert(comps)
    .values({ email: e, note: note?.trim() || null, grantedBy: byWhom, createdAt: Math.floor(Date.now() / 1000) })
    // Re-adding updates the note rather than failing: the second attempt is
    // usually somebody correcting why the person is on the list.
    .onConflictDoUpdate({ target: comps.email, set: { note: note?.trim() || null, grantedBy: byWhom } });
}

export async function removeComp(email: string): Promise<void> {
  await dbReady;
  await db.delete(comps).where(eq(comps.email, norm(email)));
}
