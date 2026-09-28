import { NextResponse } from "next/server";

import { getSession } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { markStarted } from "@/app/lib/membership";
import { paywallOn } from "@/app/lib/settings";
import { modeConfigured, stripeMode } from "@/app/lib/stripe";

/**
 * "I'm in" — the way into the product when there is nothing to buy.
 *
 * Only reachable while the deployment is not selling: paywall off, or no
 * payment provider configured. With the paywall up this route would be a way
 * to become a member without going through checkout, which is the one thing
 * the paywall is for — so it refuses rather than quietly working.
 */
export async function POST() {
  const session = await getSession();
  if (!session?.email) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const account = await findAccountByEmail(session.email);
  if (!account) return NextResponse.json({ error: "no account" }, { status: 401 });

  const [wall, payable] = await Promise.all([paywallOn(), stripeMode().then(modeConfigured)]);
  if (wall && payable) {
    return NextResponse.json({ error: "pick a plan to start" }, { status: 402 });
  }

  await markStarted(account.id);
  return NextResponse.json({ ok: true });
}
