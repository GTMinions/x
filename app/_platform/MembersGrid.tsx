"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { Member, Role, ScopeType } from "@/app/lib/platform";
import { useCopy } from "@/app/_platform/copy/client";

/** Where the grants are kept. `repo` is a leftover from the GitHub-issue store
 *  and is always null now; kept so the shape stays stable for callers. */
export type StoreInfo = { mode: "db" | "memory"; persisted: boolean; repo: string | null; error: string | null };

/** Reusable members panel: list + role select + add/remove. Used at every scope. */
export function MembersGrid({ scopeType, scopeId, members, canManage, label, store }: {
  scopeType: ScopeType; scopeId: string; members: Member[]; canManage: boolean; label?: string; store?: StoreInfo;
}) {
  const { T, t } = useCopy();
  label ??= t("site.platform.membersgrid.label-1");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("reader");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /**
   * This function used to `await fetch(...)` and never look at the result. A 403
   * "admin only", a 400, a 502 from the store and a success all did the same thing:
   * clear the input, refresh the list, say nothing. That is why the bug arrived as
   * "cannot add site admin" with no reason attached — the reason was always there,
   * in a response nobody read.
   */
  async function post(payload: object) {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scopeType, scopeId, ...payload }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ? `${body.error} (${res.status})` : t("site.platform.membersgrid.s-3", { status: res.status }));
        return;
      }
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The store's condition is a standing fact about the panel, true on first paint. The
   * error is a response to a click. Rendering them as three identical stacked lines under
   * the Add button made the reader unable to tell which one their click had caused — so
   * the standing fact is a badge on the header and only the click's answer sits under the
   * button.
   *
   * And it is shown only to someone who can act on it. The first cut rendered it for every
   * signed-in reader, which told a non-admin — who cannot add a member and does not own the
   * deploy — to go and set two environment variables.
   */
  const warn = canManage && store && !store.persisted;
  const unreachable = canManage && store?.error;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-2)", flexWrap: "wrap" }}>
        <span className="eyebrow">{label}</span>
        {/* Unreachable already implies in-memory. Saying both says one thing twice. */}
        {unreachable ? (
          <span className="pill warn"><T id="site.platform.membersgrid.span-3" /></span>
        ) : warn ? (
          <span className="pill warn"><T id="site.platform.membersgrid.span-4" /></span>
        ) : null}
      </div>
      {unreachable ? (
        <p className="muted" style={{ marginTop: 0, marginBottom: "var(--space-2)", fontSize: 13 }}>
          <T id="site.platform.membersgrid.p-3" v={{ error: store!.error }} />
        </p>
      ) : warn ? (
        <p className="muted" style={{ marginTop: 0, marginBottom: "var(--space-2)", fontSize: 13 }}>
          <T id="site.platform.membersgrid.p-4" c={[<code className="mono" />, <code className="mono" />, <code className="mono" />]} />
        </p>
      ) : null}
      <div className="card" style={{ padding: 0 }}>
        {members.length === 0 && <div className="muted" style={{ padding: "12px 16px", fontSize: 13 }}><T id="site.platform.membersgrid.div-2" /></div>}
        {members.map((m, i) => (
          <div key={m.email} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: i ? "1px solid var(--rule)" : "none" }}>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{m.email}</span>
            {canManage ? (
              <>
                <select defaultValue={m.role} onChange={(e) => post({ email: m.email, role: e.target.value })} disabled={busy} style={sel}>
                  <option value="reader"><T id="site.platform.membersgrid.option-7" /></option><option value="editor"><T id="site.platform.membersgrid.option-8" /></option><option value="admin"><T id="site.platform.membersgrid.option-9" /></option>
                </select>
                <button onClick={() => post({ email: m.email, remove: true })} disabled={busy} title="remove" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-faded)" }}><X size={14} /></button>
              </>
            ) : <span className="pill">{m.role}</span>}
          </div>
        ))}
      </div>
      {canManage && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {/* Editing the email clears the error: a stale "admin only (403)" under an input
              whose contents have since changed is describing a request nobody made. */}
          <input value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} placeholder="email@…" style={{ ...sel, flex: 1, minWidth: 160 }} />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)} style={sel}>
            <option value="reader"><T id="site.platform.membersgrid.option-10" /></option><option value="editor"><T id="site.platform.membersgrid.option-11" /></option><option value="admin"><T id="site.platform.membersgrid.option-12" /></option>
          </select>
          {/* The input clears only on success now. Clearing it on failure threw away
              what the user typed and left them nothing to retry with. */}
          <button className="btn" disabled={busy || !email.includes("@")} onClick={async () => { const e = email; await post({ email: e, role }); setEmail((cur) => (cur === e ? "" : cur)); }}><T id="site.platform.membersgrid.button-2" /></button>
        </div>
      )}

      {err && (
        <p style={{ marginTop: "var(--space-2)", fontSize: 13, color: "var(--status-bad)" }} role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

const sel: React.CSSProperties = { padding: "6px 8px", borderRadius: 6, border: "1px solid var(--rule)", background: "var(--bg-card)", color: "var(--ink)", fontSize: 12.5 };
