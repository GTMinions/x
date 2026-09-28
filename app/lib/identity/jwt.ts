import "server-only";

// Mint + verify the x-session access JWT.
//
// Both halves are local: this app signs with its own key and verifies against
// its own published keys, so a session survives with no external identity
// service reachable. Verification walks every published key, which is what lets
// a key rotation happen without signing everyone out.

import { SignJWT, jwtVerify, importPKCS8, importJWK } from "jose";
import { getActiveSigningKey, listPublishedKeys } from "./keys";

export interface JwtClaims {
  sub: string; // accounts.external_id
  type: string; // consumer | business | developer | service
  scopes: string[];
  email?: string;
  name?: string;
  iss: string;
  iat: number;
  exp: number;
}

/**
 * Who issued this token. Defaults to this deployment's own URL — it is the
 * provider, so it vouches for itself. Overridable so several apps can share one
 * issuer string, but nothing outside this repo is required for it to be correct.
 *
 * Must match the value the verifiers use (`app/lib/auth.ts`, `proxy.ts`), which is
 * why all three read the same variables in the same order. Changing it
 * invalidates outstanding tokens, which shows up as everyone being signed out.
 */
export const ISSUER =
  process.env.AUTH_ISSUER ??
  process.env.ACCOUNTS_ISSUER ??
  process.env.APP_URL ??
  "http://localhost:4000";
const ACCESS_TTL = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 86400);

export async function mintAccessToken(input: {
  externalId: string;
  type: string;
  scopes?: string[];
  email?: string;
  name?: string;
}): Promise<{ token: string; expiresAt: number }> {
  const key = await getActiveSigningKey();
  const privateKey = await importPKCS8(key.privatePem, key.alg);
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ACCESS_TTL;
  const token = await new SignJWT({
    type: input.type,
    scopes: input.scopes ?? [],
    email: input.email,
    name: input.name,
  })
    .setProtectedHeader({ alg: key.alg, kid: key.kid, typ: "JWT" })
    .setSubject(input.externalId)
    .setIssuer(ISSUER)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);
  return { token, expiresAt: exp };
}

export async function verifyAccessToken(token: string): Promise<JwtClaims | null> {
  try {
    const keys = await listPublishedKeys();
    for (const k of keys) {
      try {
        const publicKey = await importJWK(k.publicJwk as any, k.alg);
        const { payload } = await jwtVerify(token, publicKey, { issuer: ISSUER });
        return payload as unknown as JwtClaims;
      } catch {
        // try next key
      }
    }
    return null;
  } catch {
    return null;
  }
}
