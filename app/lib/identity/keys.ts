import "server-only";

// RS256 signing-key access, in priority order:
//
//   1. ACCOUNTS_JWT_PRIVATE_KEY / _PUBLIC_KEY  — an explicitly supplied key.
//   2. the active row in `signing_keys`        — what a previous run generated.
//   3. a freshly generated keypair, persisted  — so a clone with no secrets works.
//
// Step 3 is the standalone guarantee. This module used to throw instead: it was
// written when a separate accounts service owned key lifecycle and this app was only a
// co-signer, so "no key" meant "misconfigured". With the identity provider now
// living here, "no key" just means "first run", and the right answer is to make
// one rather than refuse to boot.
//
// The generated key is persisted, because a key regenerated per process would
// invalidate every session on each cold start and could never verify a token a
// sibling instance minted.

import { importJWK, exportJWK, generateKeyPair, exportPKCS8 } from "jose";
import { eq, isNull } from "drizzle-orm";
import { db, dbReady } from "./db";
import { signingKeys } from "./schema";

export interface SigningKey {
  kid: string;
  alg: string;
  publicJwk: Record<string, unknown>;
  privatePem: string;
}

let _active: SigningKey | null = null;

export async function getActiveSigningKey(): Promise<SigningKey> {
  if (_active) return _active;

  // Env override — the production path. Supplying the key here rather than
  // letting it be generated keeps it out of the database and lets several
  // instances verify each other's tokens without sharing one.
  if (
    process.env.ACCOUNTS_JWT_PRIVATE_KEY &&
    process.env.ACCOUNTS_JWT_PUBLIC_KEY
  ) {
    const kid = process.env.ACCOUNTS_JWT_KID ?? "env";
    _active = {
      kid,
      alg: "RS256",
      publicJwk: JSON.parse(process.env.ACCOUNTS_JWT_PUBLIC_KEY),
      privatePem: process.env.ACCOUNTS_JWT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
    return _active;
  }

  await dbReady;
  const [existing] = await db
    .select()
    .from(signingKeys)
    .where(eq(signingKeys.active, 1))
    .limit(1);
  if (existing) {
    _active = {
      kid: existing.kid,
      alg: existing.alg,
      publicJwk: JSON.parse(existing.publicJwk),
      privatePem: existing.privatePem,
    };
    return _active;
  }

  _active = await generateAndPersistKey();
  return _active;
}

/**
 * First run: mint an RS256 keypair and store it.
 *
 * Two instances can reach this at the same moment on a cold deploy, so the write
 * is followed by a re-read: whoever lost the race adopts the row that landed
 * rather than signing with a key nobody else will accept. `onConflictDoNothing`
 * makes the insert safe to lose.
 */
async function generateAndPersistKey(): Promise<SigningKey> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const publicJwk = (await exportJWK(publicKey)) as Record<string, unknown>;
  const privatePem = await exportPKCS8(privateKey);
  const kid = `x-${Date.now().toString(36)}`;

  try {
    await db
      .insert(signingKeys)
      .values({
        kid,
        alg: "RS256",
        publicJwk: JSON.stringify(publicJwk),
        privatePem,
        active: 1,
      })
      .onConflictDoNothing();

    // Re-read: if a concurrent boot won, use theirs, not ours.
    const [row] = await db
      .select()
      .from(signingKeys)
      .where(eq(signingKeys.active, 1))
      .limit(1);
    if (row) {
      console.warn(`[identity] using signing key ${row.kid} from signing_keys`);
      return {
        kid: row.kid,
        alg: row.alg,
        publicJwk: JSON.parse(row.publicJwk),
        privatePem: row.privatePem,
      };
    }
  } catch (e) {
    // A read-only or unreachable DB should not take sign-in down entirely. An
    // in-memory key still signs and verifies within this instance; it just does
    // not survive a restart, and the log says so rather than letting a mystery
    // "invalid token" appear after every deploy.
    console.error(
      "[identity] could not persist a signing key — using an in-memory one. " +
        "Sessions will not survive a restart. Set ACCOUNTS_JWT_PRIVATE_KEY/_PUBLIC_KEY " +
        "or make the identity DB writable.",
      e,
    );
  }

  return { kid, alg: "RS256", publicJwk, privatePem };
}

/** Every currently-valid public key (active + retired-not-revoked), so
 *  tokens issued around a rotation still verify. Includes the env key. */
export async function listPublishedKeys(): Promise<SigningKey[]> {
  const out: SigningKey[] = [];
  if (
    process.env.ACCOUNTS_JWT_PRIVATE_KEY &&
    process.env.ACCOUNTS_JWT_PUBLIC_KEY
  ) {
    out.push(await getActiveSigningKey());
  }
  try {
    await dbReady;
    const rows = await db
      .select()
      .from(signingKeys)
      .where(isNull(signingKeys.retiredAt));
    for (const r of rows) {
      if (out.some((k) => k.kid === r.kid)) continue;
      out.push({
        kid: r.kid,
        alg: r.alg,
        publicJwk: JSON.parse(r.publicJwk),
        privatePem: r.privatePem,
      });
    }
  } catch {
    // DB unreachable — the env key alone verifies every token this app minted,
    // which is the self-sustaining guarantee.
  }
  if (out.length === 0) out.push(await getActiveSigningKey());
  return out;
}

/** Public JWKS view for /.well-known/jwks.json. */
export async function publicJwks(): Promise<{ keys: Record<string, unknown>[] }> {
  const keys = await listPublishedKeys();
  return { keys: keys.map((k) => ({ ...k.publicJwk, kid: k.kid, use: "sig", alg: k.alg })) };
}

// re-export for verify paths that want to import a JWK
export { importJWK };
