import { NextResponse } from "next/server";
import { verifyEmailCode } from "@/app/lib/identity/otp";
import { getOrCreateConsumerByEmail } from "@/app/lib/identity/accounts";
import { scopesForRole } from "@/app/lib/identity/scopes";
import { mintAccessToken } from "@/app/lib/identity/jwt";
import { issueSession } from "@/app/lib/identity/sessions";
import { hit, clientIp } from "@/app/lib/rateLimit";

/**
 * POST /api/auth/otp/verify — step 2 of sign-in. Body: { email, code }
 *
 * This used to forward the pair to a separate accounts service and copy the access token
 * out of that service's response. It now does the whole thing: check the code,
 * resolve the account, mint the session, set the cookies.
 */
export const runtime = "nodejs";

const ACCESS_COOKIE = "x-session";
const REFRESH_COOKIE = "x-refresh";
const COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN || undefined;

/** Addresses that get `role: admin` the first time they sign in. Same variable
 *  the membership store seeds from, so the JWT and the membership table agree
 *  about who runs this deployment instead of each having its own opinion. */
import { adminEmails } from "@/app/lib/onboarding";

/** Per-IP cap on guesses. `otp.ts` burns a code after 5 wrong attempts, but a
 *  caller can request a fresh code and spend 5 more — indefinitely. This bounds
 *  the outer loop that the per-code counter cannot see. */
const IP_LIMIT = Number(process.env.OTP_VERIFY_IP_LIMIT ?? 20);
const IP_WINDOW_MS = Number(process.env.OTP_VERIFY_IP_WINDOW_MS ?? 10 * 60 * 1000);

export async function POST(req: Request) {
  const rl = hit(`otpv:ip:${clientIp(req)}`, IP_LIMIT, IP_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => null)) as
    | { email?: string; code?: string }
    | null;
  const email = body?.email?.trim().toLowerCase();
  const code = body?.code?.trim();
  if (!email || !code) {
    return NextResponse.json({ error: "Enter the code we emailed you." }, { status: 400 });
  }

  let verdict: Awaited<ReturnType<typeof verifyEmailCode>>;
  try {
    verdict = await verifyEmailCode(email, code);
  } catch (e) {
    console.error("[auth] verify failed:", e);
    return NextResponse.json({ error: "Could not complete sign-in." }, { status: 500 });
  }

  if (!verdict.ok) {
    // "expired" and "too-many-attempts" are worth distinguishing, because the
    // person's next action differs: ask for a new code vs. wait. "no-code" and
    // "mismatch" share one message so the endpoint does not confirm which
    // addresses have a code outstanding.
    const message =
      verdict.reason === "expired"
        ? "That code has expired — request a new one."
        : verdict.reason === "too-many-attempts"
          ? "Too many attempts. Request a new code."
          : "That code didn't work.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  try {
    const account = await getOrCreateConsumerByEmail(email);

    // Admin standing is COMPUTED at each sign-in, never stored on the account.
    // The stored version was a third authority beside memberships and
    // SITE_ADMIN_EMAILS, written once and never revoked — an address removed
    // from the bootstrap list kept minting admin tokens forever.
    const role = (await adminEmails()).includes(email.toLowerCase()) ? "admin" : "user";

    const { token, expiresAt } = await mintAccessToken({
      externalId: account.externalId,
      type: account.accountType,
      scopes: scopesForRole(role),
      email: account.primaryEmail ?? email,
      name: account.displayName ?? undefined,
    });

    const session = await issueSession({
      accountId: account.id,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });

    const prod = process.env.NODE_ENV === "production";
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ACCESS_COOKIE, token, {
      domain: COOKIE_DOMAIN,
      path: "/",
      httpOnly: true,
      secure: prod,
      sameSite: "lax",
      expires: new Date(expiresAt * 1000),
    });
    res.cookies.set(REFRESH_COOKIE, session.refreshToken, {
      domain: COOKIE_DOMAIN,
      path: "/",
      httpOnly: true,
      secure: prod,
      sameSite: "lax",
      expires: new Date(session.expiresAt * 1000),
    });
    return res;
  } catch (e) {
    console.error("[auth] could not establish a session:", e);
    return NextResponse.json({ error: "Could not complete sign-in." }, { status: 500 });
  }
}
