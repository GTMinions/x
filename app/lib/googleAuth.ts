/**
 * Google sign-in — the half that lives in x.
 *
 * Google's OAuth client has the callback registered on *this* app's origins
 * (the deployed domain and localhost:4000), not on the identity provider, so x runs
 * the OAuth dance and does the code exchange itself.
 *
 * What it does with the result changed. x used to POST the Google ID token to
 * `the accounts service's Google endpoint` and let accounts mint the session.
 * That endpoint does not exist and never did — accounts only ever shipped the
 * email-code routes (`otp/request`, `otp/verify`, `refresh`, `jwks`, `logout`),
 * so the flow 404'd at the last step and every Google sign-in failed. The button
 * hid the failure by hiding itself, because the client id was never set either.
 *
 * x completes the sign-in itself now: it writes the account to its own identity
 * database and signs the session with its own key, the same one it publishes at
 * /.well-known/jwks.json. See `app/lib/identity/`.
 *
 * Both spellings of the client id are accepted (GOOGLE_* and GOOGLE_OAUTH_*), so
 * a value copied from a deployment that used either name works without edits.
 */
export const GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
export const GOOGLE_CLIENT_SECRET =
  process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";

/** True when both halves of the Google client are present. */
export const googleEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

/**
 * Half a client: an id with no secret, or the reverse. The button used to hide
 * itself in this state, which is how a deployment ran for days with Google
 * sign-in "working on it" and nobody able to see what was missing (wish #13 —
 * production carried GOOGLE_CLIENT_ID and nothing else). The sign-in page says
 * so instead. Naming WHICH half is safe: it names an env var, never its value.
 */
export const googleHalfConfigured = Boolean(GOOGLE_CLIENT_ID) !== Boolean(GOOGLE_CLIENT_SECRET);
export const googleMissingHalf = GOOGLE_CLIENT_ID ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID";

/**
 * Google as configured now: the environment, else what /setup saved. The
 * constants above are the environment-only reading, kept for modules that
 * cannot await; routes and pages honour the settings form through this.
 */
export async function googleStatus(): Promise<{ clientId: string; clientSecret: string; enabled: boolean; halfConfigured: boolean; missingHalf: string }> {
  const { googleConfig } = await import("./onboarding");
  const c = await googleConfig();
  return {
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    enabled: Boolean(c.clientId && c.clientSecret),
    halfConfigured: Boolean(c.clientId) !== Boolean(c.clientSecret),
    missingHalf: c.clientId ? "GOOGLE_CLIENT_SECRET" : "GOOGLE_CLIENT_ID",
  };
}

/** Anti-CSRF state, round-tripped through Google and checked on the callback. */
export const STATE_COOKIE = "x-google-state";

/**
 * State is `<nonce>.<base64url(next)>`.
 *
 * The separator must be a character `encodeURIComponent` leaves alone, because
 * Set-Cookie serialization percent-encodes the value while Google echoes `state`
 * back verbatim. A `:` here becomes `%3A` in the cookie and the two can never
 * compare equal. `.` and the base64url alphabet are all unreserved.
 */
const SEP = ".";

export function encodeState(nonce: string, next: string): string {
  return `${nonce}${SEP}${Buffer.from(next).toString("base64url")}`;
}

/**
 * Must match a redirect URI registered on the Google client *exactly*, so it is
 * derived from the request origin rather than an env var that can drift:
 *   https://<your domain>/api/v1/auth/google/callback
 *   http://localhost:4000/api/v1/auth/google/callback
 */
export function googleRedirectUri(origin: string): string {
  return `${origin}/api/v1/auth/google/callback`;
}

/** The `next` path packed into the state by /start. */
export function decodeState(state: string): { nonce: string; next: string } | null {
  const at = state.indexOf(SEP);
  if (at <= 0) return null;
  const nonce = state.slice(0, at);
  const packed = state.slice(at + 1);
  if (!nonce || !packed) return null;
  try {
    const next = Buffer.from(packed, "base64url").toString("utf8");
    return {
      nonce,
      next: next.startsWith("/") && !next.startsWith("//") ? next : "/",
    };
  } catch {
    return null;
  }
}
