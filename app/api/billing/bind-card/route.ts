import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { createCheckoutSession, modeConfigured, stripeMode } from "@/app/lib/stripe";

/**
 * Bind a card without buying anything — the free tier's requirement.
 *
 * A hosted checkout in `setup` mode, so no card form lives in this codebase.
 * The webhook flips `has_card` when the intent succeeds; nothing here writes it,
 * because a redirect can be forged and a signature cannot.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.email) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const account = await findAccountByEmail(session.email);
  if (!account) return NextResponse.json({ error: "no account" }, { status: 401 });

  const mode = await stripeMode();
  if (!modeConfigured(mode)) {
    return NextResponse.json({ error: `payments are not configured in ${mode} mode` }, { status: 503 });
  }

  const origin = req.nextUrl.origin;
  try {
    const url = await createCheckoutSession({
      mode: "setup",
      accountId: account.id,
      email: session.email,
      successUrl: `${origin}/wishes?card=bound`,
      cancelUrl: `${origin}/pricing`,
      idempotencyKey: `bind:${account.id}:${mode}:${Math.floor(Date.now() / 600_000)}`,
    });
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] bind-card failed", err);
    return NextResponse.json({ error: "could not start card setup" }, { status: 502 });
  }
}
