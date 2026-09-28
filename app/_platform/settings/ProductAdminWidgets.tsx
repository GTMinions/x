"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { LayoutRow, ExportRequest } from "@/app/lib/platform";
import { useCopy } from "@/app/_platform/copy/client";

async function postJson(url: string, body: object) {
  return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function MetaForm({ slug, prdUrl, figmaUrl, canEdit }: { slug: string; prdUrl: string; figmaUrl: string; canEdit: boolean }) {
  const { T } = useCopy();
  const router = useRouter();
  const [prd, setPrd] = useState(prdUrl);
  const [figma, setFigma] = useState(figmaUrl);
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 460 }}>
      <label className="muted" style={{ fontSize: 12 }}><T id="site.platform.settings.productadminwidgets.label-3" /></label>
      <input value={prd} onChange={(e) => setPrd(e.target.value)} disabled={!canEdit} placeholder="https://…" style={inp} />
      <label className="muted" style={{ fontSize: 12 }}><T id="site.platform.settings.productadminwidgets.label-4" /></label>
      <input value={figma} onChange={(e) => setFigma(e.target.value)} disabled={!canEdit} placeholder="https://…" style={inp} />
      {canEdit && <button className="btn" style={{ width: "fit-content" }} disabled={busy} onClick={async () => { setBusy(true); await postJson("/api/admin/product", { slug, kind: "meta", prdUrl: prd, figmaUrl: figma }); setBusy(false); router.refresh(); }}><T id="site.platform.settings.productadminwidgets.button-8" /></button>}
    </div>
  );
}

export function FreezeButton({ slug, status, canManage }: { slug: string; status: "active" | "frozen"; canManage: boolean }) {
  const { t } = useCopy();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (!canManage) return <span className={`pill ${status === "active" ? "ok" : ""}`}>{status}</span>;
  return (
    <button className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); await postJson("/api/admin/product", { slug, kind: "status", status: status === "active" ? "frozen" : "active" }); setBusy(false); router.refresh(); }}>
      {status === "active" ? t("site.platform.settings.productadminwidgets.button-9") : t("site.platform.settings.productadminwidgets.button-10")}
    </button>
  );
}

export function WorkspaceLayout({ slug, rows, canEdit }: { slug: string; rows: LayoutRow[]; canEdit: boolean }) {
  const { t } = useCopy();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function act(body: object) { setBusy(true); await postJson("/api/admin/workspace", { slug, ...body }); setBusy(false); router.refresh(); }
  return (
    <div className="card" style={{ padding: 0 }}>
      {rows.map((row, i) => (
        <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: i ? "1px solid var(--rule)" : "none", opacity: row.visible ? 1 : 0.5 }}>
          <span className="mono muted" style={{ fontSize: 12, width: 18 }}>{i + 1}</span>
          <span style={{ flex: 1 }}>{row.label}</span>
          {canEdit && (
            <>
              <button disabled={busy || i === 0} onClick={() => act({ kind: "move", sectionKey: row.key, dir: "up" })} style={iconBtn}><ChevronUp size={14} /></button>
              <button disabled={busy || i === rows.length - 1} onClick={() => act({ kind: "move", sectionKey: row.key, dir: "down" })} style={iconBtn}><ChevronDown size={14} /></button>
              <button disabled={busy} onClick={() => act({ kind: "toggle", sectionKey: row.key, visible: !row.visible })} className={`pill ${row.visible ? "ok" : ""}`} style={{ cursor: "pointer" }}>{row.visible ? t("site.platform.settings.productadminwidgets.button-11") : t("site.platform.settings.productadminwidgets.button-12")}</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export function ExportPanel({ slug, kinds, requests }: { slug: string; kinds: { key: string; label: string }[]; requests: ExportRequest[] }) {
  const { T, t } = useCopy();
  const router = useRouter();
  const [kind, setKind] = useState(kinds[0]?.key ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a className="btn ghost" href={`/api/products/${slug}/export?format=json`}><T id="site.platform.settings.productadminwidgets.a-3" /></a>
        <a className="btn ghost" href={`/api/products/${slug}/export?format=standalone`}><T id="site.platform.settings.productadminwidgets.a-4" /></a>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted" style={{ fontSize: 12 }}><T id="site.platform.settings.productadminwidgets.span-3" /></span>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={inp2}>
          {kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
        </select>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("site.platform.settings.productadminwidgets.placeholder-3")} style={{ ...inp2, flex: 1, minWidth: 140 }} />
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await postJson(`/api/products/${slug}/export/request`, { kind, note }); setNote(""); setBusy(false); router.refresh(); }}><T id="site.platform.settings.productadminwidgets.button-13" /></button>
      </div>
      {requests.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          {requests.map((r, i) => (
            <div key={r.id} style={{ display: "flex", gap: 10, padding: "8px 14px", borderTop: i ? "1px solid var(--rule)" : "none", fontSize: 13 }}>
              <span className="pill">{kinds.find((k) => k.key === r.kind)?.label ?? r.kind}</span>
              <span className="muted" style={{ flex: 1 }}>{r.note}</span>
              <span className="pill warn">{r.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 13, background: "var(--bg-card)", color: "var(--ink)" };
const inp2: React.CSSProperties = { padding: "6px 8px", border: "1px solid var(--rule)", borderRadius: 6, fontSize: 12.5, background: "var(--bg-card)", color: "var(--ink)" };
const iconBtn: React.CSSProperties = { border: "1px solid var(--rule)", background: "var(--bg-card)", borderRadius: 6, cursor: "pointer", padding: 3, color: "var(--ink-soft)" };
