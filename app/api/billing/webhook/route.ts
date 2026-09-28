import { NextResponse, type NextRequest } from "next/server";
import { eq, sql } from "drizzle-orm";

import { db, dbReady } from "@/app/lib/identity/db";
import { accountUsage } from "@/app/lib/identity/schema";
import { siteStripeMode, verifyWebhook } from "@/app/lib/stripe";
import { listTiers, readTier } from "@/app/lib/tiers";

/**
 * The only writer of `account_usage.tier`.
 *
 * A checkout redirect cannot do this job: it can be forged, and a person can
 * close the tab before it fires. The webhook is signed and arrives whether or
 * not anybody's browser survived.
 */
export const dynamic = "force-dynamic";

/** Find the tier a price id belongs to. Stripe reports the price; the mapping
 *  back to a tier lives in our own rows. */
async function tierForPrice(priceId: string, mode: "test" | "live"): Promise<string | null> {
  const tiers = await listTiers();
  return tiers.find((t) => t.stripePrice[mode] === priceId)?.id ?? null;
}

async function setAccount(accountId: number, fields: { tier?: string; hasCard?: boolean; customer?: string | null; mode?: "test" | "live" }) {
  await dbReady;
  await db.insert(accountUsage).values({ accountId }).onConflictDoNothing();
  // A completed checkout IS entering the product. Stamped here rather than on
  // the success redirect, which can be forged and which a closed tab never
  // reaches — the same reason the tier is written here and not there.
  const set: Record<string, unknown> = {
    updatedAt: Math.floor(Date.now() / 1000),
    startedAt: sql`COALESCE(${accountUsage.startedAt}, unixepoch())`,
  };
  if (fields.tier !== undefined) set.tier = fields.tier;
  if (fields.hasCard !== undefined) set.hasCard = fields.hasCard;
  if (fields.customer !== undefined && fields.mode) {
    set[fields.mode === "live" ? "stripeCustomerLive" : "stripeCustomerTest"] = fields.customer;
  }
  await db.update(accountUsage).set(set).where(eq(accountUsage.accountId, accountId));
}

export async function POST(req: NextRequest) {
  // The RAW body, byte for byte — a parse-and-restringify changes the bytes and
  // every signature fails.
  const raw = await req.text();

  // The event says which Stripe sent it. Both endpoints — sandbox and live —
  // point here, so the site's switch cannot decide which secret to check: an
  // admin's sandbox checkout on a live site is a test event that must still
  // land, and a live subscription renewing while the site is in sandbox must
  // still be honoured. `livemode` is inside the signed body, so it cannot be
  // forged without the matching secret.
  let livemode: boolean | null = null;
  try {
    const peek = JSON.parse(raw) as { livemode?: unknown };
    if (typeof peek.livemode === "boolean") livemode = peek.livemode;
  } catch {
    // handled below: the signature check fails first, then the JSON parse
  }
  const mode: "test" | "live" = livemode === null ? await siteStripeMode() : livemode ? "live" : "test";

  const verdict = verifyWebhook(raw, req.headers.get("stripe-signature"), mode);
  if (!verdict.ok) {
    console.warn(`[billing] webhook rejected: ${verdict.why}`);
    return NextResponse.json({ error: "signature" }, { status: 400 });
  }

  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  const meta = (obj.metadata ?? {}) as Record<string, unknown>;
  const accountId = Number(meta.account_id ?? obj.client_reference_id);

  // Not an error: Stripe sends events for objects this platform never created.
  if (!Number.isInteger(accountId) || accountId <= 0) {
    return NextResponse.json({ ok: true, ignored: `${event.type}: no account_id` });
  }

  const customer = typeof obj.customer === "string" ? obj.customer : null;

  switch (event.type) {
    case "checkout.session.completed": {
      // A completed checkout means a card is on file, whatever it bought.
      await setAccount(accountId, { hasCard: true, customer, mode });
      return NextResponse.json({ ok: true, handled: event.type });
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const items = ((obj.items as { data?: { price?: { id?: string } }[] })?.data ?? []);
      const priceId = items[0]?.price?.id;
      const status = String(obj.status ?? "");

      // Only these statuses entitle anybody. `past_due` deliberately still
      // does: dunning takes days, and cutting service on the first failed
      // charge punishes an expired card as if it were non-payment.
      const entitled = status === "active" || status === "trialing" || status === "past_due";
      const tier = entitled && priceId ? await tierForPrice(priceId, mode) : null;

      await setAccount(accountId, { tier: tier ?? "free", hasCard: true, customer, mode });
      return NextResponse.json({ ok: true, handled: event.type, tier: tier ?? "free" });
    }

    case "customer.subscription.deleted": {
      // Back to free, and the card stays on file — it was already given, and
      // the free tier requires one anyway.
      await setAccount(accountId, { tier: "free", customer, mode });
      return NextResponse.json({ ok: true, handled: event.type });
    }

    case "setup_intent.succeeded": {
      // The free tier's card binding, which buys nothing.
      await setAccount(accountId, { hasCard: true, customer, mode });
      return NextResponse.json({ ok: true, handled: event.type });
    }

    default:
      // 200, deliberately. A non-2xx makes Stripe retry an event this endpoint
      // is never going to handle, for days.
      return NextResponse.json({ ok: true, ignored: event.type });
  }
}
