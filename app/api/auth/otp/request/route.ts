import { NextResponse } from "next/server";
import { issueEmailCode, codeEmail } from "@/app/lib/identity/otp";
import { sendMail, smtpConfigured } from "@/app/lib/identity/mailer";
import { hit, clientIp } from "@/app/lib/rateLimit";

/**
 * POST /api/auth/otp/request — step 1 of sign-in. Body: { email }
 *
 * This used to POST the address to a separate accounts service and let that service
 * generate and send the code. It is local now: the code is minted and stored
 * here, and this app sends the mail.
 *
 * The response is deliberately uninformative. Whether the address is known,
 * whether it was rate-limited, whether the send bounced — all the same `{ok:true}`.
 * An endpoint that answers those questions tells an attacker which addresses have
 * accounts, and this one takes an arbitrary address from an unauthenticated caller.
 */
export const runtime = "nodejs";

/** Per-IP cap. `otp.ts` also caps per ADDRESS, and both are needed: the address
 *  cap stops one inbox being flooded, this stops one caller walking a list of a
 *  thousand addresses. Neither alone closes the hole. */
const IP_LIMIT = Number(process.env.OTP_IP_LIMIT ?? 10);
const IP_WINDOW_MS = Number(process.env.OTP_IP_WINDOW_MS ?? 10 * 60 * 1000);

export async function POST(req: Request) {
  // Before parsing anything: this endpoint is unauthenticated, and it sends mail
  // to whatever address the caller names.
  const ip = clientIp(req);
  const rl = hit(`otp:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many sign-in requests. Try again shortly." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => null)) as { email?: string } | null;
  const email = body?.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  // With no mail transport and no dev fallback there is no way for the person to
  // learn the code, so say so plainly instead of pretending a code is on its way.
  if (!(await smtpConfigured()) && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Sign-in email is not configured on this deployment." },
      { status: 503 },
    );
  }

  let issued: Awaited<ReturnType<typeof issueEmailCode>>;
  try {
    issued = await issueEmailCode(email);
  } catch (e) {
    console.error("[auth] could not issue a code:", e);
    return NextResponse.json({ error: "Could not start sign-in." }, { status: 500 });
  }

  // Rate-limited. Answer exactly as we would on success.
  if (!issued) return NextResponse.json({ ok: true });

  const mail = codeEmail(issued.code);
  const result = await sendMail({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    devFallback: issued.code,
  });

  if (!result.sent && result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  // `devCode` is only ever populated off-production by the mailer, so a
  // misconfigured prod deploy cannot leak one through this field.
  return NextResponse.json({ ok: true, devCode: result.devCode });
}
