import { NextResponse, type NextRequest } from "next/server";

import { getSession } from "@/app/lib/auth";
import { setCreditSetting, type SettingKey } from "@/app/lib/credits";
import { roleAtLeast } from "@/app/lib/memberships";
import { setPaywall } from "@/app/lib/settings";
import { keyShapeMismatch, modeConfigured, SESSION_MODE_COOKIE, setStripeMode, type StripeMode } from "@/app/lib/stripe";

/**
 * The two billing switches an admin can throw from the page.
 *
 * The mode toggle refuses to point at a slot that is empty or holds the wrong
 * kind of key. Refusing here rather than at checkout time matters because the
 * person throwing the switch is looking at this response; the person hitting
 * the broken checkout later would just see a failure they cannot explain.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const isAdmin = await roleAtLeast(session?.email, "site", "site", "admin");
  if (!isAdmin) return NextResponse.json({ error: "site admins only" }, { status: 403 });

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const who = session?.email ?? "admin";

  if (payload.action === "set-mode") {
    const mode = payload.mode === "live" ? "live" : payload.mode === "test" ? "test" : null;
    if (!mode) return NextResponse.json({ error: "mode must be test or live" }, { status: 400 });

    if (!modeConfigured(mode as StripeMode)) {
      return NextResponse.json(
        { error: `${mode} mode has no keys configured — set them before switching, or the switch points at nothing.` },
        { status: 409 },
      );
    }
    const mismatch = keyShapeMismatch(mode as StripeMode);
    if (mismatch) return NextResponse.json({ error: mismatch }, { status: 409 });

    await setStripeMode(mode as StripeMode, who);
    return NextResponse.json({ ok: true, mode });
  }

  // This admin's own browser only — a cookie, never the setting. Cleared with
  // mode: null. Same refusals as the site switch: an override may not point at
  // an empty or mis-keyed slot either.
  if (payload.action === "set-session-mode") {
    if (payload.mode === null || payload.mode === undefined || payload.mode === "") {
      const res = NextResponse.json({ ok: true, sessionMode: null });
      res.cookies.delete(SESSION_MODE_COOKIE);
      return res;
    }
    const mode = payload.mode === "live" ? "live" : payload.mode === "test" ? "test" : null;
    if (!mode) return NextResponse.json({ error: "mode must be test, live or null" }, { status: 400 });
    if (!modeConfigured(mode)) {
      return NextResponse.json({ error: `${mode} mode has no keys configured on this deployment.` }, { status: 409 });
    }
    const mismatch = keyShapeMismatch(mode);
    if (mismatch) return NextResponse.json({ error: mismatch }, { status: 409 });
    console.warn(`[billing] ${who} switched their own session to ${mode} mode`);
    const res = NextResponse.json({ ok: true, sessionMode: mode });
    res.cookies.set(SESSION_MODE_COOKIE, mode, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // No maxAge: a session cookie, gone when the browser closes.
    });
    return res;
  }

  if (payload.action === "set-paywall") {
    await setPaywall(payload.on === true, who);
    return NextResponse.json({ ok: true, paywall: payload.on === true });
  }

  if (payload.action === "set-credit-setting") {
    const key = typeof payload.key === "string" ? (payload.key as SettingKey) : null;
    const value = Number(payload.value);
    if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
    try {
      await setCreditSetting(key, value, who);
      return NextResponse.json({ ok: true, key, value: Math.trunc(value) });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
