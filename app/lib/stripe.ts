import "server-only";

/**
 * Stripe, in two modes, with the switch between them stored rather than deployed.
 *
 * THE MODE IS THE WHOLE POINT OF THIS FILE
 * Stripe is two accounts wearing one name: a sandbox where nothing is real, and
 * a live account where a click moves somebody's money. They have different keys,
 * different webhook secrets, and different product ids — a price created in the
 * sandbox does not exist in live. So "which Stripe" is not a detail, it is the
 * question, and getting it wrong is either charging a test card for real work or
 * charging a real card for a test.
 *
 * Two rules follow, and they are the reason this is not four `process.env` reads
 * scattered through the routes:
 *
 *   1. **Nothing outside this file names a key.** Every caller asks for the
 *      client, and the client is already the right one. There is no code path
 *      where somebody reaches for `STRIPE_SECRET_KEY` and gets whichever mode
 *      happened to be configured.
 *
 *   2. **`test` is the default, everywhere, always.** Unset, unreadable
 *      database, half-configured account — every one of those lands in the
 *      sandbox. The failure mode of a payments integration should be "no money
 *      moved", never "money moved and we did not mean it".
 *
 * WHY NO SDK
 * The REST calls used here are three: create a Checkout Session, create a
 * Billing Portal session, and verify a webhook signature. The first two are
 * form-encoded POSTs; the third is an HMAC. Against that, the `stripe` package
 * is a dependency in a repository where `package.json` is a Tier 0 path
 * precisely because a dependency runs with everything the build can reach. When
 * the integration is provisioned and the SDK arrives with it, this file is the
 * one place that changes.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { getSetting, setSetting } from "./settings";
import { getSession, isSiteAdmin as sessionIsSiteAdmin } from "./auth";
import { roleAtLeast } from "./memberships";

export type StripeMode = "test" | "live";

export const STRIPE_MODE_KEY = "stripe.mode";

/**
 * Which Stripe the SITE is talking to — the switch every visitor's checkout
 * follows. Set from Settings → Billing (and Settings → Site).
 *
 * Defaults to `test` on every failure path — see rule 2 above. A value in the
 * table that is not exactly `live` is read as `test`, so a typo cannot promote
 * the sandbox to production.
 */
export async function siteStripeMode(): Promise<StripeMode> {
  return (await getSetting(STRIPE_MODE_KEY, "test")) === "live" ? "live" : "test";
}

/**
 * A site admin's OWN override, for this browser only. The dock sets it: an
 * operator can run a sandbox checkout on a live site — or rehearse live on a
 * sandbox site — without moving the switch under everyone else.
 *
 * Same trust rule as view-as (app/lib/impersonation.ts): a second cookie that
 * is never a replacement for the setting, re-checked against the real session
 * on every read, and worth nothing to anyone who is not a site admin. A
 * non-admin who set it would otherwise buy a live tier through the sandbox.
 */
export const SESSION_MODE_COOKIE = "x-payment-mode";

/**
 * The pure rule, so it can be tested without a request: an override counts
 * only when it names a mode, the holder is a site admin, and that mode has
 * keys — an override pointing at an empty slot is ignored, never trusted to
 * fail later at checkout.
 */
export function resolveStripeMode(input: {
  site: StripeMode;
  override: string | null | undefined;
  isAdmin: boolean;
  configured: (m: StripeMode) => boolean;
}): { mode: StripeMode; source: "site" | "session" } {
  const o = input.override === "live" ? "live" : input.override === "test" ? "test" : null;
  if (o && input.isAdmin && input.configured(o)) return { mode: o, source: "session" };
  return { mode: input.site, source: "site" };
}

/** The site mode, the session override if one is in force, and which won. */
export async function stripeModeDetail(): Promise<{ mode: StripeMode; source: "site" | "session"; site: StripeMode }> {
  const site = await siteStripeMode();
  let override: string | null = null;
  let isAdmin = false;
  try {
    const jar = await cookies();
    override = jar.get(SESSION_MODE_COOKIE)?.value ?? null;
    if (override) {
      const session = await getSession();
      isAdmin = sessionIsSiteAdmin(session) || (await roleAtLeast(session?.email, "site", "site", "admin"));
    }
  } catch {
    // No request in scope (a script, a webhook, a build): the site mode stands.
  }
  const r = resolveStripeMode({ site, override, isAdmin, configured: modeConfigured });
  return { ...r, site };
}

/**
 * Which Stripe THIS request is talking to: the session override for a site
 * admin who set one, otherwise the site's switch. Everything that creates a
 * checkout, a portal session or a card binding reads this. The webhook does
 * not — it takes the mode from the event itself (app/api/billing/webhook).
 */
export async function stripeMode(): Promise<StripeMode> {
  return (await stripeModeDetail()).mode;
}

export async function setStripeMode(mode: StripeMode, byWhom: string): Promise<void> {
  await setSetting(STRIPE_MODE_KEY, mode === "live" ? "live" : "test", byWhom);
}

// ── keys ────────────────────────────────────────────────────────────────────

type Keys = { secret: string | null; publishable: string | null; webhookSecret: string | null };

/** Read the pair for one mode. Never returns a value from the other mode — a
 *  half-configured live account fails closed rather than silently borrowing the
 *  sandbox's key and appearing to work. */
export function keysFor(mode: StripeMode): Keys {
  const suffix = mode === "live" ? "LIVE" : "TEST";
  const pick = (name: string) => process.env[`STRIPE_${name}_${suffix}`]?.trim() || null;
  return {
    secret: pick("SECRET_KEY"),
    publishable: pick("PUBLISHABLE_KEY"),
    webhookSecret: pick("WEBHOOK_SECRET"),
  };
}

/** Can this mode take a payment at all? Rendered on the admin switch, so the
 *  answer is visible before the switch is thrown rather than after. */
export function modeConfigured(mode: StripeMode): boolean {
  // The secret key alone. Everything here goes through Stripe-hosted pages —
  // checkout, portal, card setup are all server-created sessions the browser is
  // redirected to — so no page ever loads Stripe.js, and the publishable key
  // has no reader. Requiring it would gate the whole billing stack on a
  // credential nothing uses. Wire it back the day a client-side Elements form
  // appears — until then it has no slot in the config either.
  return Boolean(keysFor(mode).secret);
}

/** A key from the wrong mode is the one mistake worth catching early: an
 *  `sk_live_` pasted into the TEST slot means the sandbox switch charges real
 *  cards. Checked by shape, which is the only check available offline. */
export function keyShapeMismatch(mode: StripeMode): string | null {
  const secret = keysFor(mode).secret;
  if (!secret) return null;
  // Restricted keys (`rk_`) are accepted alongside secret ones: they carry a
  // narrower grant, so refusing them would push an operator toward the more
  // dangerous credential. What still matters is the MODE — a live key in the
  // test slot is the mistake that charges somebody real money.
  const want = mode === "live" ? "live" : "test";
  const m = /^(sk|rk)_(test|live)_/.exec(secret);
  if (!m) {
    return `STRIPE_SECRET_KEY_${mode.toUpperCase()} does not look like a Stripe key ` +
      "(expected sk_… or rk_…). Check it was pasted whole.";
  }
  if (m[2] === want) return null;
  return `STRIPE_SECRET_KEY_${mode.toUpperCase()} holds a ${m[2]} key. ` +
    `Swap them before touching the switch — the ${mode} slot must hold a ${want}-mode key.`;
}

// ── the API ─────────────────────────────────────────────────────────────────

const API = "https://api.stripe.com/v1";

class StripeError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = "StripeError";
  }
}

/**
 * One form-encoded POST, with the current mode's key.
 *
 * `idempotencyKey` is not optional in spirit: a create that is retried without
 * one makes a second Checkout Session, and on some endpoints a second charge.
 * Every caller here passes one derived from what it is doing.
 */
async function post(path: string, form: Record<string, string>, idempotencyKey: string) {
  const mode = await stripeMode();
  const { secret } = keysFor(mode);
  if (!secret) throw new StripeError(0, "not_configured", `Stripe is not configured for ${mode} mode.`);

  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": idempotencyKey,
      "stripe-version": "2025-04-30.basil",
    },
    body: new URLSearchParams(form).toString(),
  });

  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & Record<string, unknown>;
  if (!res.ok) {
    throw new StripeError(res.status, body.error?.code ?? "stripe_error", body.error?.message ?? `Stripe returned ${res.status}`);
  }
  return body;
}

/**
 * Hosted checkout. Returns the URL to send the person to.
 *
 * `setup` mode collects a card and charges nothing — the free tier's binding.
 * It takes no line items, and the account id rides on the SetupIntent's own
 * metadata because `setup_intent.succeeded` arrives without the session.
 */
export async function createCheckoutSession(input: {
  priceId?: string;
  mode: "subscription" | "payment" | "setup";
  accountId: number;
  email: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
}): Promise<string> {
  const fields: Record<string, string> = {
    mode: input.mode,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.email,
    client_reference_id: String(input.accountId),
    // Read back on the webhook. `client_reference_id` alone is not enough on
    // subscription events, which arrive without the session.
    "metadata[account_id]": String(input.accountId),
  };
  if (input.mode === "setup") {
    fields["setup_intent_data[metadata][account_id]"] = String(input.accountId);
    // Accounts with Managed Payments on (the default on newer accounts) refuse
    // setup mode outright. Collecting a card charges nothing, so there is no
    // payment for Stripe to manage — opt out for this request only. The
    // currency is required in setup mode even though nothing is charged: it
    // decides which payment methods can be saved.
    fields["managed_payments[enabled]"] = "false";
    fields["currency"] = "usd";
  } else {
    if (!input.priceId) throw new Error(`checkout in ${input.mode} mode needs a price`);
    fields["line_items[0][price]"] = input.priceId;
    fields["line_items[0][quantity]"] = "1";
    if (input.mode === "subscription") {
      fields["subscription_data[metadata][account_id]"] = String(input.accountId);
    }
  }
  // The caller's key carries the INTENT (who, what, when); the params hash
  // makes a changed request a new key. Without it, one failed attempt poisons
  // the key for its whole window — the retry with corrected parameters is
  // refused as "same key, different params", which reads as a stuck button.
  const key = `${input.idempotencyKey}:${createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 8)}`;
  const body = await post("/checkout/sessions", fields, key);
  return String(body.url);
}

/** Stripe's own page for changing or cancelling a subscription. Cheaper and
 *  safer than building one: cancellation is where a home-made billing UI does
 *  the most damage. */
export async function createPortalSession(customerId: string, returnUrl: string, idempotencyKey: string): Promise<string> {
  const fields = { customer: customerId, return_url: returnUrl };
  const key = `${idempotencyKey}:${createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0, 8)}`;
  const body = await post("/billing_portal/sessions", fields, key);
  return String(body.url);
}

// ── webhooks ────────────────────────────────────────────────────────────────

/**
 * Verify a webhook signature, the way Stripe documents it.
 *
 * The signed payload is `timestamp.rawBody` — the RAW body, byte for byte.
 * Anything that re-serialises the JSON first (a framework that parses and
 * re-stringifies) changes the bytes and every signature fails.
 *
 * The timestamp check is not decoration: without it a captured request can be
 * replayed for ever. Five minutes is Stripe's own tolerance.
 */
export function verifyWebhook(rawBody: string, header: string | null, mode: StripeMode): { ok: true } | { ok: false; why: string } {
  const secret = keysFor(mode).webhookSecret;
  if (!secret) return { ok: false, why: `no STRIPE_WEBHOOK_SECRET_${mode.toUpperCase()} configured` };
  if (!header) return { ok: false, why: "no stripe-signature header" };

  const parts = Object.fromEntries(
    header.split(",").map((kv) => kv.split("=", 2) as [string, string]),
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return { ok: false, why: "malformed stripe-signature header" };

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return { ok: false, why: "signature timestamp outside the 5 minute tolerance" };

  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, why: "signature does not match" };

  return { ok: true };
}
