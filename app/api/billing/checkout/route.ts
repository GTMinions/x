import { NextResponse, type NextRequest } from "next/server";

import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { getSession } from "@/app/lib/auth";
import { createCheckoutSession, modeConfigured, stripeMode } from "@/app/lib/stripe";
import { priceIdFor, tierById } from "@/app/lib/tiers";

/**
 * Start a checkout for a tier.
 *
 * Takes a tier id, never a price or an amount: a client that could name the
 * price could name a different one. The price comes from the tier row in the
 * mode the site is currently in.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.email) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const account = await findAccountByEmail(session.email);
  if (!account) return NextResponse.json({ error: "no account" }, { status: 401 });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const tier = await tierById(typeof payload.tier === "string" ? payload.tier : null);
  if (!tier.listed) return NextResponse.json({ error: "that tier is not on sale" }, { status: 404 });

  const mode = await stripeMode();
  if (!modeConfigured(mode)) {
    return NextResponse.json({ error: `payments are not configured in ${mode} mode` }, { status: 503 });
  }

  const priceId = priceIdFor(tier, mode);
  if (!priceId) {
    return NextResponse.json({ error: `${tier.name} has no ${mode} price configured` }, { status: 503 });
  }

  const origin = req.nextUrl.origin;
  try {
    const url = await createCheckoutSession({
      priceId,
      mode: "subscription",
      accountId: account.id,
      email: session.email,
      successUrl: `${origin}/settings/billing?checkout=done`,
      cancelUrl: `${origin}/pricing`,
      // Bucketed by ten minutes: a double-click inside the window reuses the
      // session, while somebody who bought, cancelled, and comes back next week
      // gets a fresh one instead of a replay of a session that already closed.
      idempotencyKey: `checkout:${account.id}:${tier.id}:${mode}:${Math.floor(Date.now() / 600_000)}`,
    });
    return NextResponse.json({ url });
  } catch (err) {
    // Never surface the provider's message: it can carry key fragments and
    // account details the person cannot act on anyway.
    console.error("[billing] checkout failed", err);
    return NextResponse.json({ error: "could not start checkout" }, { status: 502 });
  }
}
