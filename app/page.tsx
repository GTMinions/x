/**
 * `/` — the same address, two different pages.
 *
 * A visitor gets the landing page: what this is, how it works, what it costs.
 * A member gets their dashboard. The address does not change because the
 * answer to "where do I go" should not depend on the reader remembering which
 * of two URLs they are entitled to.
 *
 * WHY A REDIRECT AND NOT A BRANCH IN ONE FILE
 * The two pages share nothing — different chrome, different data, different
 * job — and rendering both behind one route would make every visit pay for the
 * queries of whichever page it is not. A redirect also gives each page a real
 * URL, which is what an ad, a bookmark and the back button all need.
 *
 * The landing page stays reachable from the header as "Get started" forever,
 * including for members: the page that explained the thing should not vanish
 * the moment somebody understands it.
 */
import { redirect } from "next/navigation";

import { getSession } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { membershipFor } from "@/app/lib/membership";

export const dynamic = "force-dynamic";

export default async function Root() {
  const session = await getSession();
  const account = session?.email ? await findAccountByEmail(session.email) : null;

  // Signed out is always a visitor. No lookup, no database, no wait.
  if (!account) redirect("/get-started");

  const { member } = await membershipFor(account.id, session?.email).catch(() => ({ member: false, selling: true }));
  redirect(member ? "/dashboard" : "/get-started");
}
