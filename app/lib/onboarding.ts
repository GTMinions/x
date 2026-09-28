/**
 * Everything the site needs beyond the host and database keys, collected on
 * /setup and kept in the site settings table — not in the environment.
 *
 *   admin.emails       who administers this site (env SITE_ADMIN_EMAILS still counts)
 *   smtp.*             how sign-in codes are mailed          (env SMTP_* still counts)
 *   google.*           Google sign-in                        (env GOOGLE_CLIENT_* still counts)
 *
 * The environment always wins when both are set, so an existing deployment
 * keeps working and a value in the environment cannot be overridden from a
 * web form. Secrets stored here (a mail password, a Google client secret) sit
 * in the identity database in plain text — the same posture as `.env.local`
 * on the same disk, and the database is the thing a credential already guards.
 *
 * LOCAL SINGLE-USER
 * A site that runs on the machine you are sitting at, answering on localhost,
 * signs its owner in automatically: there is nobody else to keep out, and a
 * code printed in a terminal is friction for nobody's benefit. It is off the
 * moment the request comes from anywhere but localhost, on Vercel, and in a
 * production build — a reverse proxy in front of `next start` rewrites the
 * Host header to its upstream, which is exactly "localhost:4000", so the Host
 * header alone cannot be trusted there. `X_SINGLE_USER=1` turns it on for a
 * production build on a personal machine; `X_SINGLE_USER=0` turns it off
 * everywhere, for a shared machine. `pnpm dev` and `pnpm start` bind to
 * 127.0.0.1, so reaching the site at all means being on the machine.
 *
 * FIRST RUN
 * Before any admin exists, the settings form still has to be usable by the
 * owner and nobody else. Locally that is the single-user rule. On Vercel the
 * proof is the host key itself: paste the Vercel token once, the server
 * compares it with its own. No new secret is invented.
 */
import "server-only";
import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { getSetting, setSetting } from "./settings";

export const KEYS = {
  adminEmails: "admin.emails",
  smtpHost: "smtp.host",
  smtpPort: "smtp.port",
  smtpUser: "smtp.user",
  smtpPass: "smtp.pass",
  smtpFrom: "smtp.from",
  googleClientId: "google.client_id",
  googleClientSecret: "google.client_secret",
} as const;

const split = (v: string) => v.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

/** Every administrator: the environment's list plus the one saved on /setup. */
export async function adminEmails(): Promise<string[]> {
  const env = split(process.env.SITE_ADMIN_EMAILS ?? "");
  const saved = split(await getSetting(KEYS.adminEmails, "").catch(() => ""));
  return [...new Set([...env, ...saved])];
}

export type MailConfig = { host: string; port: number; user: string; pass: string; from: string };

/** SMTP from the environment, else from settings; null when neither is complete. */
export async function mailConfig(): Promise<MailConfig | null> {
  const e = process.env;
  if (e.SMTP_HOST && e.SMTP_USER && e.SMTP_PASS) {
    return { host: e.SMTP_HOST, port: Number(e.SMTP_PORT ?? 465), user: e.SMTP_USER, pass: e.SMTP_PASS, from: e.SMTP_FROM || e.SMTP_USER };
  }
  const [host, port, user, pass, from] = await Promise.all(
    [KEYS.smtpHost, KEYS.smtpPort, KEYS.smtpUser, KEYS.smtpPass, KEYS.smtpFrom].map((k) => getSetting(k, "").catch(() => "")),
  );
  if (host && user && pass) return { host, port: Number(port || 465), user, pass, from: from || user };
  return null;
}

export type GoogleConfig = { clientId: string; clientSecret: string };

/** Google OAuth from the environment, else from settings. Empty strings when unset. */
export async function googleConfig(): Promise<GoogleConfig> {
  const id = process.env.GOOGLE_CLIENT_ID ?? process.env.GOOGLE_OAUTH_CLIENT_ID ?? "";
  const secret = process.env.GOOGLE_CLIENT_SECRET ?? process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? "";
  if (id || secret) return { clientId: id, clientSecret: secret };
  const [clientId, clientSecret] = await Promise.all([
    getSetting(KEYS.googleClientId, "").catch(() => ""),
    getSetting(KEYS.googleClientSecret, "").catch(() => ""),
  ]);
  return { clientId, clientSecret };
}

/** Which ways in exist on this deployment. */
export async function signInMethods(): Promise<{ mail: boolean; google: boolean }> {
  const [m, g] = await Promise.all([mailConfig(), googleConfig()]);
  return { mail: Boolean(m), google: Boolean(g.clientId && g.clientSecret) };
}

// ── local single-user ────────────────────────────────────────────────────────

const LOCAL_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** The rule, given the Host header of the request. */
export function isLocalSingleUser(host: string | null | undefined): boolean {
  if (process.env.VERCEL) return false;
  const flag = process.env.X_SINGLE_USER;
  if (flag === "0") return false;
  if (flag !== "1" && process.env.NODE_ENV === "production") return false;
  return LOCAL_HOSTS.test((host ?? "").trim());
}

/** The same rule for the current request, from inside a server component or route. */
export async function localSingleUserRequest(): Promise<boolean> {
  try {
    const h = await headers();
    return isLocalSingleUser(h.get("x-forwarded-host") ?? h.get("host"));
  } catch {
    return false;
  }
}

/** The owner's address for the automatic local session: the first admin, else a placeholder. */
export async function localOwnerEmail(): Promise<string> {
  return (await adminEmails())[0] ?? "owner@localhost";
}

// ── first run ────────────────────────────────────────────────────────────────

/** True while no administrator exists anywhere — the window the owner proof is for. */
export async function firstRunOpen(): Promise<boolean> {
  return (await adminEmails()).length === 0;
}

/** Does this string equal the host key? Constant-time; false when there is no host key. */
export function ownerProof(token: string | null | undefined): boolean {
  const real = process.env.VERCEL_TOKEN ?? "";
  if (!real || !token) return false;
  const a = Buffer.from(real);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── saving ───────────────────────────────────────────────────────────────────

export type OnboardingInput = {
  adminEmails?: string;
  smtp?: { host?: string; port?: string; user?: string; pass?: string; from?: string };
  google?: { clientId?: string; clientSecret?: string };
};

/** Write what /setup collected. Blank fields are left as they were; a field of "-" clears. */
export async function saveOnboarding(input: OnboardingInput, by: string): Promise<void> {
  const put = async (key: string, v: string | undefined) => {
    if (v === undefined) return;
    const value = v.trim();
    if (!value) return;
    await setSetting(key, value === "-" ? "" : value, by);
  };
  if (input.adminEmails !== undefined) await put(KEYS.adminEmails, split(input.adminEmails).join(","));
  await put(KEYS.smtpHost, input.smtp?.host);
  await put(KEYS.smtpPort, input.smtp?.port);
  await put(KEYS.smtpUser, input.smtp?.user);
  await put(KEYS.smtpPass, input.smtp?.pass);
  await put(KEYS.smtpFrom, input.smtp?.from);
  await put(KEYS.googleClientId, input.google?.clientId);
  await put(KEYS.googleClientSecret, input.google?.clientSecret);
}
