"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/app/_platform/copy/client";

/**
 * x's own sign-in. Two steps — email, then the 6-digit code. Identity is this
 * app's: the code, the account and the session are all issued here, and the
 * cookie is set on this origin, so it works on localhost and in production alike.
 */
export function SignInForm({
  next,
  google,
  googleHint,
  initialError,
}: {
  next: string;
  google: boolean;
  /** Rendered when Google is half-configured — the state the hidden button used to mask. */
  googleHint?: string;
  initialError?: string;
}) {
  const { T, t } = useCopy();
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [busy, setBusy] = useState(false);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/otp/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? t("site.signin.signinform.s-1"));
        return;
      }
      setStep("code");
      if (d.test) setHint(t("site.signin.signinform.s-2"));
      else if (d.devCode) setHint(t("site.signin.signinform.s-3", { devCode: d.devCode }));
      else setHint(t("site.signin.signinform.s-4", { email }));
    } catch {
      setError(t("site.signin.signinform.s-5"));
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error ?? t("site.signin.signinform.s-6"));
        return;
      }
      // The cookie is set; land on the page they were originally after.
      router.replace(next);
      router.refresh();
    } catch {
      setError(t("site.signin.signinform.s-7"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 420, margin: "72px auto" }}>
      <div className="eyebrow"><T id="site.signin.signinform.div-1" /></div>
      <h1 style={{ marginTop: 8, marginBottom: 6 }}>x</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 14 }}>
        {step === "email"
          ? t("site.signin.signinform.p-1")
          : hint}
      </p>

      {step === "email" && !google && googleHint && (
        <p className="muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>{googleHint}</p>
      )}

      {step === "email" && google && (
        <>
          <a
            className="btn ghost"
            href={`/api/v1/auth/google/start?next=${encodeURIComponent(next)}`}
            style={{ marginTop: 18, width: "100%", justifyContent: "center", gap: 8 }}
          >
            <T id="site.signin.signinform.a-1" c={[<GoogleMark />]} />
          </a>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 10,
              margin: "16px 0 2px", color: "var(--ink-faded)", fontSize: 12,
            }}
          >
            <T id="site.signin.signinform.div-2" c={[<span style={{ flex: 1, height: 1, background: "var(--rule-soft)" }} />, <span style={{ flex: 1, height: 1, background: "var(--rule-soft)" }} />]} />
          </div>
        </>
      )}

      {step === "email" ? (
        <form onSubmit={requestCode} style={{ marginTop: 18 }}>
          <label className="eyebrow" htmlFor="email"><T id="site.signin.signinform.label-1" /></label>
          <input
            id="email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="you@example.com"
            style={INPUT}
          />
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 14, width: "100%" }}>
            {busy ? t("site.signin.signinform.button-1") : t("site.signin.signinform.button-2")}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyCode} style={{ marginTop: 18 }}>
          <label className="eyebrow" htmlFor="code"><T id="site.signin.signinform.label-2" /></label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            autoFocus
            value={code}
            onChange={(ev) => setCode(ev.target.value)}
            placeholder="000000"
            style={{ ...INPUT, letterSpacing: "0.3em", fontFamily: "var(--font-mono)" }}
          />
          <button className="btn" type="submit" disabled={busy} style={{ marginTop: 14, width: "100%" }}>
            {busy ? t("site.signin.signinform.button-3") : t("site.signin.signinform.button-4")}
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ marginTop: 8, width: "100%" }}
            onClick={() => { setStep("email"); setCode(""); setError(null); }}
          >
            <T id="site.signin.signinform.button-5" />
          </button>
        </form>
      )}

      {error && (
        <p style={{ marginTop: 12, marginBottom: 0, fontSize: 13, color: "var(--status-bad)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/** Google's mark, per their branding rules — the four-colour G, unmodified. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.500h7.1c4.2-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C3 17 2 20.4 2 24s1 7 2.5 9.9l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.1 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  );
}

const INPUT: React.CSSProperties = {
  width: "100%",
  marginTop: 6,
  padding: "9px 11px",
  fontSize: 15,
  color: "var(--ink)",
  background: "var(--bg-sunk)",
  border: "1px solid var(--rule)",
  borderRadius: "var(--radius-sm)",
};
