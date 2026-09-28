"use client";

import { useState } from "react";
import { useCopy } from "@/app/_platform/copy/client";

/** Sends the tier id, never a price — the server reads the price from the row.
 *  The same POST→url→redirect shape serves card binding, which buys nothing. */
export function CheckoutButton({
  tier,
  label,
  signedIn,
  endpoint = "/api/billing/checkout",
}: {
  tier?: string;
  label: string;
  signedIn: boolean;
  endpoint?: string;
}) {
  const { T, t } = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <a className="btn" href={`/sign-in?next=${encodeURIComponent("/pricing")}`}>
        <T id="site.getstarted.checkoutbutton.a-1" />
      </a>
    );
  }

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(tier ? { tier } : {}),
      });
      const body = (await res.json()) as { url?: string; ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? t("site.getstarted.checkoutbutton.s-1"));
        setBusy(false);
        return;
      }
      // Two shapes, one button. A checkout hands back a URL to hand off to; the
      // no-paywall start route just says ok, and the destination is ours.
      if (!body.url) {
        window.location.href = "/dashboard";
        return;
      }
      // Deliberately not resetting `busy`: the page is being replaced, and a
      // button that becomes clickable again during the redirect gets clicked.
      window.location.href = body.url;
    } catch {
      setError(t("site.getstarted.checkoutbutton.s-2"));
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button className="btn" type="button" onClick={go} disabled={busy}>
        {busy ? t("site.getstarted.checkoutbutton.button-1") : label}
      </button>
      {error ? (
        <span style={{ fontSize: 13, color: "var(--danger, #b4232a)" }}>{error}</span>
      ) : null}
    </div>
  );
}
