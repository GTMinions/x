"use client";

/**
 * The pending queue: approve or decline, one wish at a time.
 *
 * WHY EACH ROW SHOWS THE WHOLE BODY
 * A reviewer's decision is "should the loop spend a run on this", and that is
 * not answerable from a title. A list of titles with two buttons beside each
 * would get clicked through, which is worse than no gate — it would launder
 * unread wishes as reviewed. So the body is shown in full, and the row is as
 * tall as the wish is long.
 *
 * WHY DECLINE ASKS FOR A REASON AND APPROVE DOES NOT
 * Approving tells the filer what they hoped: the wish itself is the
 * explanation. Declining ends someone's request, and "declined" with no
 * sentence attached is the thing that makes people stop filing. The reason is
 * optional rather than required — a required field gets "n/a" typed into it —
 * but it is asked for every time.
 *
 * Optimistic on purpose: the decided row leaves the list at once. A reviewer
 * working through a queue should not wait on a round trip between rows, and a
 * failure puts the row back with the error on it.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Ban, ChevronRight } from "lucide-react";
import { useCopy } from "@/app/_platform/copy/client";

export type PendingWish = {
  id: number;
  scope: string;
  scopeName: string;
  title: string;
  body: string;
  nickname: string;
  createdAt: string;
};

export function ReviewQueue({ wishes }: { wishes: PendingWish[] }) {
  const { T, t } = useCopy();
  const router = useRouter();
  const [decided, setDecided] = useState<Record<number, "approve" | "reject">>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  // Publish-on-approve, per row. Defaults off: a platform wish is internal
  // until somebody decides otherwise, and the reviewer reading it right now is
  // the only person positioned to decide.
  const [publish, setPublish] = useState<Record<number, boolean>>({});

  const open = wishes.filter((w) => !decided[w.id]);

  async function act(w: PendingWish, action: "approve" | "reject", text?: string) {
    setBusy(w.id);
    setFailed((f) => ({ ...f, [w.id]: "" }));
    setDecided((d) => ({ ...d, [w.id]: action }));
    setReasonFor(null);
    setReason("");

    const res = await fetch(`/api/wishes/${w.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, text, publish: action === "approve" && !!publish[w.id] }),
    }).catch(() => null);

    setBusy(null);
    if (!res?.ok) {
      // Put it back. A row that silently vanished on a failed write would read
      // as decided, and the filer would wait forever on a decision nobody made.
      setDecided((d) => {
        const next = { ...d };
        delete next[w.id];
        return next;
      });
      const why = res ? ((await res.json().catch(() => ({}))) as { error?: string }).error : t("site.platform.reviewqueue.why-1");
      setFailed((f) => ({ ...f, [w.id]: why ?? t("site.platform.reviewqueue.s-1") }));
      return;
    }
    router.refresh();
  }

  if (!open.length) {
    const n = Object.keys(decided).length;
    return (
      <div className="card">
        <p style={{ margin: 0 }}>
          {n ? t("site.platform.reviewqueue.p-1", { n, v: n === 1 ? "" : "es" }) : t("site.platform.reviewqueue.p-2")}
        </p>
        <p className="muted" style={{ margin: "6px 0 0", fontSize: 13.5 }}>
          <T id="site.platform.reviewqueue.p-3" />
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-4)" }}>
      {open.map((w) => (
        <article key={w.id} className="card" style={{ display: "grid", gap: "var(--space-3)" }}>
          <header style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span className="mono muted" style={{ fontSize: 12 }}>#{w.id}</span>
            <strong style={{ fontSize: 16 }}>{w.title}</strong>
            <span style={{ flex: 1 }} />
            <span className="pill">{w.scopeName}</span>
          </header>

          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            <T id="site.platform.reviewqueue.p-4" v={{ nickname: w.nickname, createdAt: w.createdAt }} />
          </p>

          {w.body ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.65 }}>{w.body}</p>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              <T id="site.platform.reviewqueue.p-5" />
            </p>
          )}

          {failed[w.id] ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--status-bad, #b4232a)" }}>{failed[w.id]}</p>
          ) : null}

          {reasonFor === w.id ? (
            <div style={{ display: "grid", gap: 8 }}>
              <textarea
                className="field"
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("site.platform.reviewqueue.placeholder-1")}
                style={{ minHeight: 64 }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" disabled={busy === w.id} onClick={() => act(w, "reject", reason.trim() || undefined)}>
                  <T id="site.platform.reviewqueue.button-1" />
                </button>
                <button className="btn ghost" onClick={() => { setReasonFor(null); setReason(""); }}>
                  <T id="site.platform.reviewqueue.button-2" />
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn" disabled={busy === w.id} onClick={() => act(w, "approve")}>
                <T id="site.platform.reviewqueue.button-3" c={[<Check size={13} aria-hidden />]} />
              </button>
              {/* Only the platform board has an inside and an outside; on a
                  product board the product's own access rule already decided. */}
              {w.scope === "site" ? (
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  <T id="site.platform.reviewqueue.label-1" c={[<input
                    type="checkbox"
                    checked={!!publish[w.id]}
                    onChange={(e) => setPublish((p) => ({ ...p, [w.id]: e.target.checked }))}
                  />]} />
                </label>
              ) : null}
              <button className="btn ghost" disabled={busy === w.id} onClick={() => { setReasonFor(w.id); setReason(""); }}>
                <T id="site.platform.reviewqueue.button-4" c={[<Ban size={13} aria-hidden />]} />
              </button>
              <span style={{ flex: 1 }} />
              <Link href={`/wishes/${w.id}`} className="btn ghost">
                <T id="site.platform.reviewqueue.link-1" c={[<ChevronRight size={13} aria-hidden />]} />
              </Link>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
