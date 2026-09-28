import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { getSession } from "@/app/lib/auth";
import { findAccountByEmail } from "@/app/lib/identity/accounts";
import { db, dbReady } from "@/app/lib/identity/db";
import { accountUsage } from "@/app/lib/identity/schema";
import { createPortalSession, modeConfigured, stripeMode } from "@/app/lib/stripe";

/**
 * Open the provider's own page for changing or cancelling a subscription.
 *
 * Not built here on purpose: cancellation is where a home-made billing UI does
 * the most damage, and a person who cannot find the cancel button disputes the
 * charge instead.
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

  await dbReady;
  const [row] = await db
    .select({ test: accountUsage.stripeCustomerTest, live: accountUsage.stripeCustomerLive })
    .from(accountUsage)
    .where(eq(accountUsage.accountId, account.id))
    .limit(1);

  // Per mode: a test customer does not exist in live, and asking for one there
  // is an error the person cannot do anything about.
  const customer = mode === "live" ? row?.live : row?.test;
  if (!customer) {
    return NextResponse.json({ error: "nothing to manage yet — no payment on this account" }, { status: 404 });
  }

  try {
    const url = await createPortalSession(
      customer,
      `${req.nextUrl.origin}/settings/billing`,
      `portal:${account.id}:${mode}`,
    );
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[billing] portal failed", err);
    return NextResponse.json({ error: "could not open the billing portal" }, { status: 502 });
  }
}
