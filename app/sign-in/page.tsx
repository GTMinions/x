/**
 * Sign-in — entirely x's own. The UI, the flow, the account records and the
 * signing key all live in this app (`app/lib/identity/`), reached through
 * /api/auth/otp/* (email code) and /api/v1/auth/google/* (Google). There is no
 * external identity service in the path, so the session cookie lands on this
 * origin and localhost behaves exactly like production.
 *
 * NO SITE HEADER, deliberately — this is the one platform page without one. A
 * nav here offers a half-signed-in visitor somewhere else to go mid-flow, and
 * the profile menu inside it has no identity to render. `validate-content`
 * knows about this exemption; every other page must carry chrome.
 */
import { SignInForm } from "./SignInForm";
import { googleStatus } from "@/app/lib/googleAuth";
import { t } from "@/app/_platform/copy";

/** Callback failures come back as ?error=<slug>; say something a human can act on. */
const ERRORS: Record<string, string> = {
  "google-denied": t("site.signin.googledenied-1"),
  "google-state-mismatch": t("site.signin.googlestatemismatch-1"),
  "google-bad-state": t("site.signin.googlebadstate-1"),
  "google-bad-response": t("site.signin.googlebadresponse-1"),
  "google-exchange-failed": t("site.signin.googleexchangefailed-1"),
  "google-signin-failed": t("site.signin.googlesigninfailed-1"),
  "google-not-configured": t("site.signin.googlenotconfigured-1"),
  "google-no-email": t("site.signin.googlenoemail-1"),
  "google-email-unverified": t("site.signin.googleemailunverified-1"),
  "identity-not-configured": t("site.signin.identitynotconfigured-1"),
  "accounts-unreachable": t("site.signin.accountsunreachable-1"),
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const { enabled: googleEnabled, halfConfigured: googleHalfConfigured, missingHalf: googleMissingHalf } = await googleStatus();
  // Same-origin paths only — never bounce to an absolute URL a caller supplied.
  const dest =
    typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <SignInForm
      next={dest}
      google={googleEnabled}
      googleHint={
        googleHalfConfigured
          ? t("site.signin.signinform-1", { googleMissingHalf })
          : undefined
      }
      initialError={typeof error === "string" ? ERRORS[error] ?? t("site.signin.signinform-2") : undefined}
    />
  );
}
