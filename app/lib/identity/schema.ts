import "server-only";

// Drizzle schema for x's identity DB. `app/lib/identity/db.ts` creates these
// tables on first use, so this file and the DDL there must stay in step.
//
// Column names are inherited from the accounts service this was ported from and
// are deliberately unchanged: a deployment pointed at an existing accounts
// database then adopts the rows already in it rather than starting a second set.
//
// NOTE: this "accounts" table is the LOGIN IDENTITY (email, role). It is not a
// product's own `accounts` table, if one exists — those are different databases
// and conflating them is a real bug. Identity code imports from here.

import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at").notNull().default(sql`(unixepoch())`);
const updatedAt = () =>
  integer("updated_at").notNull().default(sql`(unixepoch())`);

// The canonical login identity. external_id is the JWT `sub`.
export const accounts = sqliteTable(
  "accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    externalId: text("external_id").notNull(),
    accountType: text("account_type").notNull(), // consumer | business | developer | service
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    status: text("status").notNull().default("active"), // active | suspended | deleted
    primaryEmail: text("primary_email"),
    primaryPhone: text("primary_phone"),
    locale: text("locale").default("en"),
    // `role` used to sit here too. It was a second authority beside
    // `memberships`, and a reader trusting the wrong one is how a permission
    // bug hides — roles live in memberships and SITE_ADMIN_EMAILS, nowhere else.
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => ({
    externalIdx: uniqueIndex("accounts_external_id_unique").on(t.externalId),
    emailIdx: uniqueIndex("accounts_primary_email_unique").on(t.primaryEmail),
    typeIdx: index("accounts_type_idx").on(t.accountType),
  }),
);

export const accountEmails = sqliteTable(
  "account_emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull(),
    email: text("email").notNull(),
    verified: integer("verified").notNull().default(0),
    addedAt: integer("added_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    emailIdx: uniqueIndex("account_emails_email_unique").on(t.email),
    accountIdx: index("account_emails_account_idx").on(t.accountId),
  }),
);

export const accountOauthLinks = sqliteTable(
  "account_oauth_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull(),
    provider: text("provider").notNull(), // google | apple | github | …
    providerUserId: text("provider_user_id").notNull(),
    rawProfile: text("raw_profile"), // JSON
    addedAt: integer("added_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    providerIdx: uniqueIndex("oauth_links_provider_user_unique").on(
      t.provider,
      t.providerUserId,
    ),
    accountIdx: index("oauth_links_account_idx").on(t.accountId),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    accountId: integer("account_id").notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    userAgent: text("user_agent"),
    ip: text("ip"),
    issuedAt: integer("issued_at").notNull().default(sql`(unixepoch())`),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => ({
    accountIdx: index("sessions_account_idx").on(t.accountId),
    refreshIdx: uniqueIndex("sessions_refresh_unique").on(t.refreshTokenHash),
  }),
);

export const otpCodes = sqliteTable(
  "otp_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    channel: text("channel").notNull(), // email | sms
    target: text("target").notNull(),
    codeHash: text("code_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => ({
    targetIdx: index("otp_codes_target_idx").on(t.channel, t.target),
  }),
);

/**
 * Which account filed which wish.
 *
 * A wish row carries a display name, not an account. That is too weak to answer
 * "who is charged when this ships?" — display names are neither unique nor
 * stable — and an account id written into the product's own wish table would
 * scatter identity across four databases.
 *
 * So the join lives here, once, beside the accounts it refers to.
 */
export const wishOwners = sqliteTable(
  "wish_owners",
  {
    wishId: integer("wish_id").primaryKey(),
    accountId: integer("account_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    accountIdx: index("wish_owners_account_idx").on(t.accountId),
  }),
);

/**
 * Who may administer what: the site → team → product → workspace grants.
 *
 * These lived in a GitHub issue, which was durable and cross-instance and also
 * a list of people's EMAIL ADDRESSES in a repository heading for public. The
 * store was chosen before the repo's visibility was decided, and the trade
 * stopped making sense the moment it was.
 *
 * The original objection to this database — recorded in memberships.ts — was
 * that `accounts.role` is a login identity shared with anything else pointed at
 * the same DB, so writing "admin" there would make an admin of x an admin of
 * everything. That objection is about the COLUMN, not the file. This is x's own
 * table, read by nothing else, and a grant in it means nothing outside x.
 */
export const memberships = sqliteTable(
  "memberships",
  {
    scopeType: text("scope_type").notNull(), // site | team | product | workspace
    scopeId: text("scope_id").notNull(),
    email: text("email").notNull(),          // lowercased by the caller
    role: text("role").notNull(),            // reader | editor | admin
    grantedAt: text("granted_at").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.scopeType, t.scopeId, t.email] }),
    emailIdx: index("memberships_email_idx").on(t.email),
    scopeIdx: index("memberships_scope_idx").on(t.scopeType, t.scopeId),
  }),
);

/**
 * What one account has consumed, for life.
 *
 * Lifetime rather than monthly, deliberately: the free tier is a trial, not an
 * allowance that refills. "Try it, then pay if it is worth it" is a sentence a
 * person understands; "you get 10M tokens a month" invites arithmetic nobody
 * wants to do, and lets someone stay free forever by pacing themselves.
 *
 * Tokens are attributed at SHIP time, from the run log's own `tokens` block via
 * `wish_owners` — a measurement the loop recorded, never an estimate. Bytes are
 * counted when an attachment is stored. See app/lib/usage.ts.
 */
export const accountUsage = sqliteTable("account_usage", {
  accountId: integer("account_id").primaryKey(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  bytesStored: integer("bytes_stored").notNull().default(0),
  wishesFiled: integer("wishes_filed").notNull().default(0),
  /** Balance in credits. Held in credits rather than tokens so that tuning the
   *  ratio does not revalue what people already own. */
  creditsPurchased: integer("credits_purchased").notNull().default(0),
  creditsSpent: integer("credits_spent").notNull().default(0),
  /** `free` | `plus`. What this account is entitled to have BUILT per day —
   *  see `app/lib/tiers.ts`. Written by the payment webhook and by an admin,
   *  never by a checkout redirect: a redirect can be forged, and a person can
   *  close the tab before it fires. */
  tier: text("tier").notNull().default("free"),
  /** When this account entered the product — set by a completed checkout, or by
   *  clicking through the landing page on a deployment with no paywall. It is
   *  what `/` branches on: before it, the landing page; after it, the dashboard. */
  startedAt: integer("started_at"),
  /** Whether a card is on file. Every tier requires one, including the free
   *  one — it is not a charge, it is what makes a second account cost
   *  something. Stored rather than asked of the payment provider on each read,
   *  because the queue asks this question once per candidate wish. */
  hasCard: integer("has_card", { mode: "boolean" }).notNull().default(false),
  /** Stripe customer id, so the billing portal can be opened without asking
   *  the person to identify themselves to Stripe a second time. Per mode:
   *  a test customer does not exist in live. */
  stripeCustomerTest: text("stripe_customer_test"),
  stripeCustomerLive: text("stripe_customer_live"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
});

/**
 * Runtime site settings an admin can change without a redeploy.
 *
 * A row rather than a module-level Map, for the reason recorded in
 * `app/lib/settings.ts`: on serverless the writer and the reader are different
 * functions, and this table holds the switch that decides whether Stripe talks
 * to the sandbox or to real cards.
 */
/**
 * Workers that have announced themselves.
 *
 * Every runner is a `worker` and nothing here records what it runs on — the
 * operator's choice, deliberately absent from this repository. What the table
 * holds is the two facts the platform needs: that something is alive, and which
 * something holds which claim.
 *
 * `last_seen_at` rather than a status column: a worker that dies does not get
 * to write "offline" first, so a status would say `online` for ever. Liveness
 * is derived from the clock, which keeps ticking whatever the worker does.
 */
export const workers = sqliteTable("workers", {
  /** Chosen by the worker and stable across its restarts, so a crash-and-retry
   *  reclaims its own lease instead of fighting itself for it. */
  id: text("id").primaryKey(),
  label: text("label"),
  registeredAt: integer("registered_at").notNull().default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at").notNull().default(sql`(unixepoch())`),
  /** Free-text, for an operator reading the list. Never rendered to a user. */
  note: text("note"),
});

/**
 * Every token spend, as a line item. The four token kinds are kept apart
 * because cache reads dominate the count at a fraction of the rate.
 * `idempotency_key` is UNIQUE — that is the defence against double billing.
 */
export const tokenLedger = sqliteTable(
  "token_ledger",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountId: integer("account_id").notNull(),
    /** Which wish this was spent on. Null for work not attributable to one. */
    wishId: integer("wish_id"),
    scope: text("scope"),
    workerId: text("worker_id"),
    /** The model that served it, as the worker reported it. Recorded because
     *  cost per token differs by model, so a total without it cannot be priced. */
    model: text("model"),
    /** What was charged, and the rate it was charged at. The rate travels with
     *  the row so a receipt survives a later change to it. */
    creditsCharged: integer("credits_charged").notNull().default(0),
    tokensPerCredit: integer("tokens_per_credit"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    /** What it cost at list rates, in cents, if the worker could compute it.
     *  Null when the rate for that model is unknown — an absent number beats a
     *  made-up one. */
    listCostCents: integer("list_cost_cents"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    keyIdx: uniqueIndex("token_ledger_key_unique").on(t.idempotencyKey),
    accountIdx: index("token_ledger_account_idx").on(t.accountId),
    wishIdx: index("token_ledger_wish_idx").on(t.wishId),
  }),
);

export const siteSettings = sqliteTable("site_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  updatedBy: text("updated_by"),
});

export const signingKeys = sqliteTable("signing_keys", {
  kid: text("kid").primaryKey(),
  alg: text("alg").notNull().default("RS256"),
  publicJwk: text("public_jwk").notNull(),
  privatePem: text("private_pem").notNull(),
  active: integer("active").notNull().default(1),
  retiredAt: integer("retired_at"),
  createdAt: createdAt(),
});

/**
 * One row per wish built, per account — the daily and monthly counts read from
 * here rather than across the product databases. Keyed on the wish so a repeated
 * report counts once; day and month are stamped at the first write.
 */
export const fulfilments = sqliteTable(
  "fulfilments",
  {
    accountId: integer("account_id").notNull(),
    wishId: integer("wish_id").notNull(),
    /** `YYYY-MM-DD`, UTC. Text because it is only ever compared for equality,
     *  and a string boundary cannot drift with a reader's timezone. */
    day: text("day").notNull(),
    month: text("month").notNull(),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.wishId] }),
    index("fulfilments_account_day").on(t.accountId, t.day),
    index("fulfilments_account_month").on(t.accountId, t.month),
  ],
);

/**
 * The tiers a deployment sells. In the database, not in the code, so a public
 * repository carries no prices. With no rows, nothing is sold and nothing is
 * ordered by rank.
 */
export const tiers = sqliteTable("tiers", {
  /** A short stable key — it is written onto `account_usage.tier` and appears in
   *  payment metadata, so renaming one would orphan every account on it. */
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  priceCents: integer("price_cents").notNull().default(0),
  /** Wishes guaranteed to be built per day / per calendar month. Null means that
   *  period places no guarantee and no bound — which is not zero. */
  perDay: integer("per_day"),
  perMonth: integer("per_month"),
  /** Higher goes first in the queue. The only thing money actually buys. */
  rank: integer("rank").notNull().default(0),
  requiresCard: integer("requires_card", { mode: "boolean" }).notNull().default(true),
  blurb: text("blurb").notNull().default(""),
  /** A tier withdrawn from sale stays here rather than being deleted: accounts
   *  already on it keep their guarantee, and the row is what still explains it. */
  listed: integer("listed", { mode: "boolean" }).notNull().default(true),
  /** The payment provider's price for this tier, per mode. A price created in
   *  the sandbox does not exist in live, so they are separate columns and a
   *  tier with none in the current mode simply cannot be bought. Secret keys
   *  stay in the environment — those are credentials, not pricing. */
  stripePriceTest: text("stripe_price_test"),
  stripePriceLive: text("stripe_price_live"),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch())`),
  updatedBy: text("updated_by"),
});

/**
 * Comped accounts — the guest list.
 *
 * Keyed on EMAIL, not on an account id, for the same reason `memberships` is:
 * the operator invites somebody before that person has signed in, and a table
 * that can only name existing accounts cannot express an invitation. The row
 * waits; the first sign-in walks into it.
 */
export const comps = sqliteTable(
  "comps",
  {
    email: text("email").primaryKey(), // lowercased by the caller
    /** Why this person is on the list. Shown in the admin table — a guest list
     *  nobody can explain a year later is one nobody dares prune. */
    note: text("note"),
    grantedBy: text("granted_by"),
    createdAt: integer("created_at").notNull().default(sql`(unixepoch())`),
  },
  (t) => [index("comps_created_idx").on(t.createdAt)],
);
