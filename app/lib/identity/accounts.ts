import "server-only";

// Identity-account lookups + creation, against this app's identity DB.
//
// Originally ported from a separate accounts service and extended with OAuth
// (Google) linking; x owns these rows now. The table layout is unchanged, so a
// deployment pointed at a pre-existing accounts database keeps reading and
// writing the same records rather than starting a parallel set.

import { customAlphabet } from "nanoid";
import { and, eq } from "drizzle-orm";
import { db, dbReady } from "./db";
import {
  accountEmails,
  accountOauthLinks,
  accounts,
} from "./schema";

const externalSlug = customAlphabet("abcdefghijkmnpqrstuvwxyz23456789", 10);

export type AccountType = "consumer" | "business" | "developer" | "service";

export interface AccountRow {
  id: number;
  externalId: string;
  accountType: AccountType;
  displayName: string | null;
  avatarUrl: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  status: string;
}

export async function findAccountByEmail(email: string): Promise<AccountRow | null> {
  await dbReady;
  const normalized = email.trim().toLowerCase();
  const [link] = await db
    .select()
    .from(accountEmails)
    .where(eq(accountEmails.email, normalized))
    .limit(1);
  if (!link) return null;
  const [a] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, link.accountId))
    .limit(1);
  return (a as AccountRow) ?? null;
}

/**
 * The email addresses on an account.
 *
 * The reverse of `findAccountByEmail`, and needed wherever a decision starts
 * from an account id but the rule is written in terms of an address —
 * `roleAtLeast` and `SITE_ADMIN_EMAILS` both are. An account may hold more than
 * one, so this returns all of them and the caller decides whether any qualifies.
 */
export async function emailsForAccount(accountId: number): Promise<string[]> {
  await dbReady;
  const rows = await db
    .select({ email: accountEmails.email })
    .from(accountEmails)
    .where(eq(accountEmails.accountId, accountId));
  return rows.map((r) => r.email);
}

export async function findAccountByExternalId(
  externalId: string,
): Promise<AccountRow | null> {
  await dbReady;
  const [a] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.externalId, externalId))
    .limit(1);
  return (a as AccountRow) ?? null;
}

export async function getOrCreateConsumerByEmail(
  email: string,
  displayName?: string,
): Promise<AccountRow> {
  await dbReady;
  const normalized = email.trim().toLowerCase();
  const existing = await findAccountByEmail(normalized);
  if (existing) return existing;

  const externalId = externalSlug();
  const [created] = await db
    .insert(accounts)
    .values({
      externalId,
      accountType: "consumer",
      displayName: displayName ?? null,
      primaryEmail: normalized,
      status: "active",
    })
    .returning();

  await db
    .insert(accountEmails)
    .values({ accountId: created.id, email: normalized, verified: 1 });
  return created as AccountRow;
}

export interface OAuthProfile {
  provider: "google";
  providerUserId: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  avatarUrl?: string;
  raw?: unknown;
}

/**
 * Resolve an OAuth sign-in to an account, creating/linking as needed:
 *   1. existing oauth link → that account
 *   2. else email already known → link oauth to it
 *   3. else create a fresh consumer account, then link
 * Returns the account plus whether it was newly created.
 */
export async function findOrCreateByOAuth(
  profile: OAuthProfile,
): Promise<{ account: AccountRow; created: boolean }> {
  await dbReady;

  const [link] = await db
    .select()
    .from(accountOauthLinks)
    .where(
      and(
        eq(accountOauthLinks.provider, profile.provider),
        eq(accountOauthLinks.providerUserId, profile.providerUserId),
      ),
    )
    .limit(1);
  if (link) {
    const [a] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, link.accountId))
      .limit(1);
    if (a) return { account: a as AccountRow, created: false };
  }

  const email = profile.email?.trim().toLowerCase();
  const emailVerified = profile.emailVerified === true;
  const existingByEmail = email ? await findAccountByEmail(email) : null;

  // Google's `email_verified` is the ONLY thing vouching for this address.
  // Adopting an existing account on an unverified one lets anyone who can
  // set that address on a Google profile walk into it — so refuse instead.
  if (existingByEmail && !emailVerified) {
    throw new Error(
      "oauth: refusing to link an existing account on an unverified email",
    );
  }

  let account = existingByEmail;
  let created = false;

  if (!account) {
    const externalId = externalSlug();
    const [row] = await db
      .insert(accounts)
      .values({
        externalId,
        accountType: "consumer",
        displayName: profile.name ?? null,
        avatarUrl: profile.avatarUrl ?? null,
        primaryEmail: email ?? null,
        status: "active",
      })
      .returning();
    account = row as AccountRow;
    created = true;
    if (email) {
      await db.insert(accountEmails).values({
        accountId: account.id,
        email,
        verified: profile.emailVerified ? 1 : 0,
      });
    }
    } else if (!account.avatarUrl && profile.avatarUrl) {
    await db
      .update(accounts)
      .set({ avatarUrl: profile.avatarUrl })
      .where(eq(accounts.id, account.id));
  }

  // Ensure the oauth link exists (idempotent via unique index).
  await db
    .insert(accountOauthLinks)
    .values({
      accountId: account.id,
      provider: profile.provider,
      providerUserId: profile.providerUserId,
      rawProfile: profile.raw ? JSON.stringify(profile.raw) : null,
    })
    .onConflictDoNothing();

  return { account, created };
}
