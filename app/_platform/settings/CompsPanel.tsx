"use client";

/**
 * The guest list, as a table an admin maintains by hand.
 *
 * Deliberately a plain form and a plain list. This grants free access AND top
 * queue position, so the only safe version is one where every entry was typed
 * by a person, carries a note saying why, and is visible in full — a guest list
 * that grows through some clever rule is one nobody can audit or prune.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useCopy } from "@/app/_platform/copy/client";

export type CompRow = { email: string; note: string | null; grantedBy: string | null; createdAt: number };

const when = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export function CompsPanel({ comps, canManage }: { comps: CompRow[]; canManage: boolean }) {
  const { T, t } = useCopy();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/comps", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) {
      setError(out.error ?? t("site.platform.settings.compspanel.s-1"));
      return;
    }
    setEmail("");
    setNote("");
    router.refresh();
  }

  return (
    <section className="card">
      <div className="eyebrow" style={{ marginBottom: 10 }}><T id="site.platform.settings.compspanel.div-1" /></div>
      <p className="muted" style={{ margin: "0 0 14px", fontSize: 14, lineHeight: 1.6 }}>
        <T id="site.platform.settings.compspanel.p-1" c={[<strong />]} />
      </p>

      {canManage ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) send({ action: "add", email: email.trim(), note });
          }}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="them@example.com"
            aria-label={t("site.platform.settings.compspanel.label-1")}
            style={{ font: "inherit", fontSize: 13.5, flex: "1 1 220px", minWidth: 0, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--rule)", background: "var(--bg)" }}
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("site.platform.settings.compspanel.placeholder-1")}
            aria-label={t("site.platform.settings.compspanel.label-2")}
            style={{ font: "inherit", fontSize: 13.5, flex: "2 1 260px", minWidth: 0, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--rule)", background: "var(--bg)" }}
          />
          <button className="btn" type="submit" disabled={busy || !email.trim()} style={{ fontSize: 13.5 }}>
            {busy ? t("site.platform.settings.compspanel.button-1") : t("site.platform.settings.compspanel.button-2")}
          </button>
        </form>
      ) : null}

      {error ? <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--status-bad)" }}>{error}</p> : null}

      {comps.length === 0 ? (
        <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
          <T id="site.platform.settings.compspanel.p-2" />
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr className="muted" style={{ fontSize: 11.5, textAlign: "left" }}>
                <th style={{ padding: "6px 10px" }}><T id="site.platform.settings.compspanel.th-1" /></th>
                <th style={{ padding: "6px 10px" }}><T id="site.platform.settings.compspanel.th-2" /></th>
                <th style={{ padding: "6px 10px" }}><T id="site.platform.settings.compspanel.th-3" /></th>
                {canManage ? <th style={{ padding: "6px 10px", width: 40 }} /> : null}
              </tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c.email} style={{ borderTop: "1px solid var(--rule)" }}>
                  <td style={{ padding: "8px 10px" }}>{c.email}</td>
                  <td style={{ padding: "8px 10px" }} className={c.note ? undefined : "muted"}>
                    {c.note ?? "—"}
                  </td>
                  <td style={{ padding: "8px 10px" }} className="muted">
                    {when(c.createdAt)}
                    {c.grantedBy ? ` · ${c.grantedBy}` : ""}
                  </td>
                  {canManage ? (
                    <td style={{ padding: "8px 10px" }}>
                      <button
                        type="button"
                        aria-label={t("site.platform.settings.compspanel.label-3", { email: c.email })}
                        title={t("site.platform.settings.compspanel.title-1")}
                        disabled={busy}
                        onClick={() => send({ action: "remove", email: c.email })}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-faded)", padding: 2 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
