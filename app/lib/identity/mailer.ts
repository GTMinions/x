import "server-only";

/**
 * The one place x sends mail from.
 *
 * x used to send none: `/api/auth/otp/request` handed the address to
 * a separate accounts service and that service did the sending. A standalone project
 * cannot borrow someone else's mail server, so the sender moved in here.
 *
 * Unconfigured is a supported state, not a broken one. With no `SMTP_HOST` the
 * transport is null and `sendMail` reports `{ sent: false, code }` — the OTP
 * route then hands the code back to the caller in dev so sign-in still works on
 * a fresh clone with no secrets. In production that path is refused: a code
 * returned over the wire is a code anyone can read, so `isProd` turns it off
 * and the caller sees a configuration error instead.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { mailConfig } from "../onboarding";

const isProd = process.env.NODE_ENV === "production";

/** SMTP from the environment, else from what /setup saved (app/lib/onboarding.ts). */
export async function smtpConfigured(): Promise<boolean> {
  return Boolean(await mailConfig());
}

let _tx: { key: string; tx: Transporter } | null = null;
async function transport(): Promise<Transporter | null> {
  const c = await mailConfig();
  if (!c) return null;
  const key = `${c.host}:${c.port}:${c.user}`;
  if (_tx?.key === key) return _tx.tx;
  const tx = nodemailer.createTransport({
    host: c.host,
    port: c.port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Getting this backwards is
    // the single most common reason a Gmail app password "doesn't work".
    secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
  });
  _tx = { key, tx };
  return tx;
}

/** The From address. Falls back to the authenticated user, which is what most
 *  providers require anyway — Gmail rewrites a From it does not own. */
export async function mailFrom(): Promise<string> {
  return (await mailConfig())?.from || "no-reply@localhost";
}

export interface SendResult {
  sent: boolean;
  /** Set only when SMTP is unconfigured AND we are not in production. */
  devCode?: string;
  error?: string;
}

export async function sendMail(input: {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Echoed back as `devCode` when there is no transport and we are not in prod. */
  devFallback?: string;
}): Promise<SendResult> {
  const tx = await transport();

  if (!tx) {
    if (isProd) {
      return { sent: false, error: "SMTP is not configured on this deployment." };
    }
    // Local dev with no secrets: print it and let the caller show it.
    console.warn(`[mail] SMTP unconfigured — would send to ${input.to}: ${input.subject}`);
    if (input.devFallback) console.warn(`[mail] dev code: ${input.devFallback}`);
    return { sent: false, devCode: input.devFallback };
  }

  try {
    await tx.sendMail({
      from: await mailFrom(),
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { sent: true };
  } catch (e) {
    // Never leak SMTP internals to the browser; log the real thing, return a line
    // a person can act on.
    console.error("[mail] send failed:", e);
    return { sent: false, error: "Could not send the email. Check the SMTP settings." };
  }
}
