import "server-only";

/**
 * Viewing the site as somebody else, for debugging.
 *
 * "It looks wrong on my account" is unanswerable from an admin's own screen:
 * the admin bypasses the gates, holds every membership, and sees a page nobody
 * else sees. So a site admin can borrow a user's view.
 *
 * ── HOW IT CANNOT BE ABUSED ─────────────────────────────────────────────────
 * The borrowed identity is a SECOND cookie, never a replacement session. The
 * real session cookie stays exactly as it was, and every read re-checks that
 * its owner is still a site admin — so the borrowed view evaporates the moment
 * the real account loses that standing, without anybody having to remember to
 * clear it. A stolen impersonation cookie on its own is worth nothing.
 *
 * It is deliberately NOT a token: it carries an email, and the standing that
 * makes it work is re-derived on the real session every time. Signing a
 * borrowed identity into a JWT would make it outlive the authority that
 * granted it, which is the failure this shape exists to avoid.
 *
 * ── WHY IT IS READ-ONLY ─────────────────────────────────────────────────────
 * Writes keep using the real session. An admin debugging a view must not be
 * able to file, buy, or approve in somebody else's name — a support tool that
 * can act as the customer produces records nobody can honestly explain later,
 * and the customer never agreed to it. Reads answer "what do they see", which
 * is the whole question.
 */

import { cookies } from "next/headers";

import { getSession, isSiteAdmin, type Session } from "./auth";
import { findAccountByEmail } from "./identity/accounts";

export const IMPERSONATE_COOKIE = "x-view-as";

export type ViewAs = {
  /** The borrowed identity a page should render for. */
  email: string;
  /** Who is actually signed in. Always the real admin. */
  realEmail: string;
};

/**
 * The borrowed identity, if one is in force AND still authorised.
 *
 * Returns null for everybody who is not a site admin, whatever cookie they
 * hold. This is the only place the cookie is trusted, and it never trusts it
 * alone.
 */
export async function viewingAs(): Promise<ViewAs | null> {
  const jar = await cookies();
  const email = jar.get(IMPERSONATE_COOKIE)?.value?.trim().toLowerCase();
  if (!email) return null;

  const real = await getSession();
  if (!real?.email || !isSiteAdmin(real)) return null;
  // Borrowing your own view is a no-op, not an error.
  if (email === real.email.toLowerCase()) return null;

  return { email, realEmail: real.email };
}

/**
 * The session a READ should render for.
 *
 * Pages call this instead of `getSession` when they render something the
 * viewer's identity changes. The returned object is shaped like a session but
 * is built from the borrowed account, and carries no admin scopes — an admin
 * looking through a user's eyes should see the user's screen, including its
 * refusals, or the tool answers a different question than the one asked.
 */
export async function readingSession(): Promise<Session | null> {
  const borrowed = await viewingAs();
  if (!borrowed) return getSession();

  const account = await findAccountByEmail(borrowed.email);
  if (!account) return getSession();

  return {
    sub: account.externalId,
    type: (account.accountType as Session["type"]) ?? "consumer",
    // Deliberately empty. Scopes are what make an admin see everything, and
    // carrying them into a borrowed view would show the admin's page wearing
    // the user's name — the most misleading possible answer.
    scopes: [],
    email: account.primaryEmail ?? borrowed.email,
    name: account.displayName ?? undefined,
  };
}
