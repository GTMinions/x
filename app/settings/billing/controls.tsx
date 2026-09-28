"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/app/_platform/copy/client";

/**
 * The sandbox/live switch.
 *
 * Live is styled as the loud choice on purpose: this is the one control on the
 * page where a slip charges somebody real money, and a toggle that makes both
 * directions feel the same invites throwing it on the way past.
 */
export function ModeSwitch({
  current,
  modes,
}: {
  current: "test" | "live";
  modes: { mode: "test" | "live"; configured: boolean; mismatch: string | null }[];
}) {
  const { t } = useCopy();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(mode: "test" | "live") {
    if (mode === current) return;
    if (mode === "live" && !window.confirm(t("site.settings.billing.controls.s-1"))) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-mode", mode }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? t("site.settings.billing.controls.s-2"));
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 10, background: "var(--bg-sunk, #eee)" }}>
        {modes.map(({ mode, configured, mismatch }) => {
          const on = mode === current;
          const disabled = busy || (!on && (!configured || Boolean(mismatch)));
          return (
            <button
              key={mode}
              type="button"
              onClick={() => set(mode)}
              disabled={disabled}
              title={!configured ? t("site.settings.billing.controls.button-1", { mode }) : mismatch ?? undefined}
              style={{
                font: "inherit",
                fontSize: 13.5,
                fontWeight: on ? 700 : 500,
                padding: "6px 16px",
                borderRadius: 8,
                border: "none",
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled && !on ? 0.45 : 1,
                background: on ? (mode === "live" ? "var(--danger, #b4232a)" : "var(--surface, #fff)") : "transparent",
                color: on && mode === "live" ? "#fff" : "inherit",
                boxShadow: on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
              }}
            >
              {mode === "live" ? t("site.settings.billing.controls.button-2") : t("site.settings.billing.controls.button-3")}
            </button>
          );
        })}
      </div>
      {error ? <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--danger, #b4232a)" }}>{error}</p> : null}
    </div>
  );
}

/** One operator number: shown, edited in place, saved explicitly. */
export function SettingField({ name, value, fallback }: { name: string; value: number; fallback: number }) {
  const { t } = useCopy();
  const router = useRouter();
  const [draft, setDraft] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = draft.trim() !== String(value);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-credit-setting", key: name, value: Number(draft) }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(body.error ?? t("site.settings.billing.controls.s-3"));
      return;
    }
    router.refresh();
  }

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <code style={{ fontSize: 13, width: 220 }}>{name}</code>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        inputMode="numeric"
        style={{
          font: "inherit", fontSize: 13.5, padding: "5px 10px", width: 140,
          borderRadius: 8, border: "1px solid var(--rule, #ccc)", background: "var(--surface, #fff)",
        }}
        aria-label={name}
      />
      {dirty ? (
        <button className="btn" type="button" onClick={save} disabled={busy} style={{ fontSize: 13 }}>
          {busy ? t("site.settings.billing.controls.button-4") : t("site.settings.billing.controls.button-5")}
        </button>
      ) : (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {value === fallback ? t("site.settings.billing.controls.span-1") : t("site.settings.billing.controls.span-2", { fallback })}
        </span>
      )}
      {error ? <span style={{ fontSize: 12.5, color: "var(--danger, #b4232a)" }}>{error}</span> : null}
    </div>
  );
}

/**
 * The paywall switch.
 *
 * Turning it OFF lets anybody with an account file without subscribing — the
 * internal-deployment case. It confirms on the way off, because the state it
 * produces looks identical to a working paywall until somebody files.
 */
export function PaywallSwitch({ on }: { on: boolean }) {
  const { t } = useCopy();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function set(next: boolean) {
    if (!next && !window.confirm(t("site.settings.billing.controls.s-4"))) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/billing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set-paywall", on: next }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) { setError(body.error ?? t("site.settings.billing.controls.s-5")); return; }
    router.refresh();
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 10, background: "var(--bg-sunk, #eee)" }}>
        {[true, false].map((v) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => set(v)}
            disabled={busy || v === on}
            style={{
              font: "inherit", fontSize: 13.5, fontWeight: v === on ? 700 : 500,
              padding: "6px 16px", borderRadius: 8, border: "none",
              cursor: busy || v === on ? "default" : "pointer",
              background: v === on ? (v ? "var(--surface, #fff)" : "var(--warn, #a56a00)") : "transparent",
              color: v === on && !v ? "#fff" : "inherit",
              boxShadow: v === on ? "0 1px 2px rgba(0,0,0,.12)" : "none",
            }}
          >
            {v ? t("site.settings.billing.controls.button-6") : t("site.settings.billing.controls.button-7")}
          </button>
        ))}
      </div>
      {error ? <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--danger, #b4232a)" }}>{error}</p> : null}
    </div>
  );
}
