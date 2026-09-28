"use client";

/**
 * SiteDock — one 40px charcoal dock, bottom-right, replacing four floating objects.
 *
 * Before: `DesignToggle` and `AdminBar` were both pinned bottom-right and overlapped;
 * turning Design Mode on added a third toolbar bottom-left and a fourth panel over the
 * toggle; and `ViberBar` was a light tinted strip under the nav that read as product UI
 * on the platform's own pages. Four objects, three corners, one job each.
 *
 * Now: segments of one object, hairline-divided — wordmark + payment mode · shipped and
 * waiting counts · Design (with a `D` hint) · Leave a wish. Turning Design on swaps the
 * middle segments for Select / Draw box / note count / Done and stacks the note list
 * directly above the dock in the same charcoal, so the mode never moves the controls.
 *
 * Charcoal and mono is the site; parchment and sans is the product. The dock has no hue
 * of its own: the only saturated colour it ever shows belongs to a status (oxblood for
 * live payments, brass for waiting work) or to Design Mode, which is a tool temporarily
 * on top of the page.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, MousePointerSquareDashed, SquareDashed, Wand2 } from "lucide-react";
import { useDesignMode, type Tool } from "./design/DesignModeContext";
import { designScope } from "./design/DesignMode";
import { useProductSlugs } from "./registry-client";
import { useCopy } from "@/app/_platform/copy/client";

type Stats = { total: number; open: number };

export function SiteDock({
  canDesign,
  paymentMode,
  paymentSiteMode,
  paymentOverride,
  paymentSwitchable,
  isSiteAdmin,
  viewingAs,
  deploy,
  variant = "full",
}: {
  canDesign?: boolean;
  /** The mode THIS browser's checkouts use, or null when payments are not configured or you are not an admin. */
  paymentMode?: "live" | "test" | null;
  /** The site's own switch — what everyone else gets. */
  paymentSiteMode?: "live" | "test" | null;
  /** True when this browser is overriding the site's switch (a session cookie). */
  paymentOverride?: boolean;
  /** Both modes have keys, so the segment can toggle. */
  paymentSwitchable?: boolean;
  /** Gates the view-as segment. Design rights are not enough — borrowing a
   *  view reaches across every product, not just the one you administer. */
  isSiteAdmin?: boolean;
  /** The borrowed identity in force, if any. Brass, and never silent: a screen
   *  you have forgotten is not yours is how support tools produce wrong bug
   *  reports. */
  viewingAs?: string | null;
  /** The running build and whether a newer one is in trouble. Admin-only, and
   *  absent on deployments that never configured the API token. */
  deploy?: {
    version: string;
    branch: string;
    state: "live" | "building" | "failed" | "stale" | "unknown";
    latest?: string;
    latestBranch?: string;
    why?: string;
    inspectorUrl?: string;
  } | null;
  /**
   * "full" — site pages: the dock rests on screen with identity, counts and the wish CTA.
   * "design" — inside a product: nothing at rest (the product nav and ViberBar already own
   * that chrome), and the same dock appears only while Design Mode is on, so the tools and
   * the note list live in one place on every surface. Whether the resting dock should ride
   * along inside a product too is still open.
   */
  variant?: "full" | "design";
}) {
  const { T, t: copyText } = useCopy();
  const { on, setOn, tool, setTool, notes, sending, sent, submit } = useDesignMode();
  const pathname = usePathname();
  const [stats, setStats] = useState<Stats | null>(null);
  const [asPanel, setAsPanel] = useState(false);
  const [asEmail, setAsEmail] = useState("");
  const [asBusy, setAsBusy] = useState(false);
  const [asError, setAsError] = useState<string | null>(null);
  const borrowed = Boolean(viewingAs);

  async function setViewAs(next: string | null) {
    setAsBusy(true);
    setAsError(null);
    const res = await fetch("/api/admin/view-as", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next ? { email: next } : { stop: true }),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setAsBusy(false);
    if (!res.ok) { setAsError(body.error ?? copyText("site.platform.sitedock.s-1")); return; }
    setAsEmail("");
    setAsPanel(false);
    // A borrowed view changes what every server component renders, so the whole
    // tree has to be asked again — a local state flip would show the old page
    // under the new identity.
    window.location.reload();
  }

  useEffect(() => {
    if (variant !== "full") return;
    let alive = true;
    fetch("/api/wishes/stats?scope=site")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d && typeof d.total === "number") setStats({ total: d.total, open: d.open ?? 0 }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [variant]);

  // The `D` hint on the segment has to be true. Ignored while typing, or the note
  // textarea would toggle the mode off mid-sentence.
  useEffect(() => {
    if (!canDesign) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "d" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      setOn(!on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canDesign, on, setOn]);

  const live = paymentMode === "live";
  const scope = designScope(pathname, useProductSlugs());

  if (variant === "design" && !on) return null;

  return (
    <>
      {on && notes.length > 0 && (
        <div style={{ position: "fixed", right: 20, bottom: 72, zIndex: 9100, width: 320, background: BG, border: `1px solid ${EDGE}`, borderRadius: 14, boxShadow: "var(--dock-shadow)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", boxShadow: "inset 0 -1px 0 var(--nav-rule)" }}>
            <span style={{ ...MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--nav-ink-faded)" }}><T id="site.platform.sitedock.span-1" v={{ scope }} /></span>
            <span style={{ flex: 1 }} />
            <span style={{ ...MONO, fontSize: 11, color: "var(--nav-ink-soft)" }}>{notes.length}</span>
          </div>
          <div style={{ padding: "4px 0", maxHeight: 240, overflow: "auto" }}>
            {notes.map((it, i) => (
              <div key={it.id} style={{ padding: "9px 14px", boxShadow: i === notes.length - 1 ? undefined : "inset 0 -1px 0 var(--nav-rule)" }}>
                <div style={{ ...MONO, fontSize: 10, color: "var(--nav-ink-faded)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.target}</div>
                <div style={{ fontSize: 12.5, color: "var(--nav-ink-soft)", marginTop: 3, lineHeight: 1.5 }}>{it.note}</div>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 12px", boxShadow: "inset 0 1px 0 var(--nav-rule)" }}>
            <button
              type="button"
              disabled={sending}
              onClick={() => submit(scope, pathname)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, width: "100%", height: 32, border: "none", borderRadius: 8, background: "var(--nav-ink)", color: BG, fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, cursor: sending ? "progress" : "pointer" }}
            >
              {sending ? copyText("site.platform.sitedock.button-1") : copyText("site.platform.sitedock.button-2", { notes: notes.length })}
            </button>
          </div>
        </div>
      )}

      {on && sent !== null && notes.length === 0 && (
        <div style={{ position: "fixed", right: 20, bottom: 72, zIndex: 9100, display: "inline-flex", alignItems: "center", gap: 8, padding: "9px 14px", background: BG, border: `1px solid ${EDGE}`, borderRadius: 14, boxShadow: "var(--dock-shadow)", fontFamily: "var(--font-sans)", fontSize: 12.5, color: "var(--nav-ink-soft)" }}>
          <T id="site.platform.sitedock.div-2" v={{ sent, v: sent === 1 ? "" : copyText("site.platform.sitedock.div-1") }} c={[<span style={{ width: 6, height: 6, borderRadius: 999, background: IVY }} />]} />
        </div>
      )}

      {asPanel && isSiteAdmin && !on && (
        <div style={{ position: "fixed", right: 20, bottom: 72, zIndex: 9100, width: 268, background: BG, border: `1px solid ${EDGE}`, borderRadius: 14, boxShadow: "var(--dock-shadow)", overflow: "hidden", fontFamily: "var(--font-sans)" }}>
          <div style={{ padding: "11px 13px", display: "grid", gap: 8 }}>
            <span style={{ ...MONO, fontSize: 10, letterSpacing: "0.08em", color: "var(--nav-ink-faded)" }}><T id="site.platform.sitedock.span-2" /></span>
            {borrowed ? (
              <>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--nav-ink)", lineHeight: 1.5 }}>
                  <T id="site.platform.sitedock.p-1" v={{ viewingAs }} c={[<strong />]} />
                </p>
                <button
                  type="button"
                  disabled={asBusy}
                  onClick={() => setViewAs(null)}
                  style={{ height: 30, border: "none", borderRadius: 8, background: "var(--nav-ink)", color: BG, fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, cursor: asBusy ? "progress" : "pointer" }}
                >
                  {asBusy ? copyText("site.platform.sitedock.button-3") : copyText("site.platform.sitedock.button-4")}
                </button>
              </>
            ) : (
              <>
                <form
                  onSubmit={(e) => { e.preventDefault(); if (asEmail.trim()) setViewAs(asEmail.trim()); }}
                  style={{ display: "flex", gap: 6 }}
                >
                  <input
                    type="email"
                    value={asEmail}
                    onChange={(e) => setAsEmail(e.target.value)}
                    placeholder="their@email"
                    aria-label={copyText("site.platform.sitedock.label-1")}
                    style={{ font: "inherit", fontSize: 12.5, flex: 1, minWidth: 0, height: 30, padding: "0 9px", borderRadius: 8, border: `1px solid ${EDGE}`, background: "transparent", color: "var(--nav-ink)" }}
                  />
                  <button
                    type="submit"
                    disabled={asBusy || !asEmail.trim()}
                    style={{ height: 30, padding: "0 12px", border: "none", borderRadius: 8, background: "var(--nav-ink)", color: BG, fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                  >
                    {asBusy ? "…" : copyText("site.platform.sitedock.button-5")}
                  </button>
                </form>
                <p style={{ margin: 0, fontSize: 11.5, color: "var(--nav-ink-faded)", lineHeight: 1.5 }}>
                  <T id="site.platform.sitedock.p-2" />
                </p>
              </>
            )}
            {asError && <span style={{ fontSize: 11.5, color: "var(--status-bad)" }}>{asError}</span>}
          </div>
        </div>
      )}

      <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 9100, display: "flex", alignItems: "stretch", height: 40, background: BG, border: `1px solid ${EDGE}`, borderRadius: 14, boxShadow: "var(--dock-shadow)", overflow: "hidden", whiteSpace: "nowrap", fontFamily: "var(--font-sans)" }}>

        {/* identity + payment mode. Live is the one state where a casual test checkout
            charges a real card, so it takes the whole segment rather than a chip. */}
        <div style={{ display: "inline-flex", alignItems: "center", gap: 9, padding: "0 13px 0 15px", flexShrink: 0, background: live ? "var(--status-bad)" : "transparent" }}>
          <span style={{ fontFamily: "var(--font-serif)", fontWeight: 700, fontSize: 17, lineHeight: 1, color: live ? "#fff" : "var(--nav-ink)" }}><T id="site.platform.sitedock.span-3" /></span>
          {on ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...MONO, fontSize: 10.5, letterSpacing: "0.06em", color: IVY }}>
              <T id="site.platform.sitedock.span-4" c={[<span style={{ width: 6, height: 6, borderRadius: 999, background: IVY, animation: "pulse 2s ease-in-out infinite" }} />]} />
            </span>
          ) : paymentMode ? (
            <PaymentSegment
              mode={paymentMode}
              siteMode={paymentSiteMode ?? paymentMode}
              override={!!paymentOverride}
              switchable={!!paymentSwitchable}
              live={live}
            />
          ) : null}
        </div>

        {isSiteAdmin && deploy ? (
          <>
            <Rule />
            {/* Green only when the newest build is the one answering. A failed
                build never runs, so the old instance keeps serving and the site
                looks perfect — that is the state this segment exists to catch. */}
            {/* A link only when there is somewhere real to go. Without a URL
                this is a status readout, and dressing it as a link that lands
                on a dashboard index is worse than plain text — the one moment
                somebody clicks it is the moment a build broke. */}
            {(() => {
              const Tag = deploy.inspectorUrl ? "a" : "span";
              return (
            <Tag
              {...(deploy.inspectorUrl ? { href: deploy.inspectorUrl, target: "_blank", rel: "noreferrer" } : {})}
              title={copyText("site.platform.sitedock.title-2", { branch: deploy.branch, version: deploy.version, v: deploy.branch === "release" ? " (production)" : deploy.branch === "local" ? "" : " (preview)", v2: deploy.state === "live" ? copyText("site.platform.sitedock.tag-1")
                : deploy.state === "building" ? copyText("site.platform.sitedock.tag-2", { latest: deploy.latest ? ` · ${deploy.latest}` : "" })
                : deploy.state === "failed" ? copyText("site.platform.sitedock.tag-3", { latest: deploy.latest ? ` · ${deploy.latest}` : "" })
                : deploy.state === "stale" ? copyText("site.platform.sitedock.tag-4", { latest: deploy.latest ? ` · ${deploy.latest}` : "" })
                : deploy.why ?? copyText("site.platform.sitedock.tag-5"), latestBranch: deploy.latestBranch ? copyText("site.platform.sitedock.tag-6", { latestBranch: deploy.latestBranch, latest: deploy.latest ? ` · ${deploy.latest}` : "" }) : "", v3: deploy.inspectorUrl ? copyText("site.platform.sitedock.tag-7") : "" })
              }
              style={{ ...SEGMENT_BTN, gap: 7, padding: "0 13px", textDecoration: "none", color: "var(--nav-ink-faded)" }}
            >
              <span
                aria-hidden
                style={{
                  width: 7, height: 7, borderRadius: 999, flexShrink: 0,
                  background:
                    deploy.state === "live" ? "#6f8a76"
                    : deploy.state === "building" ? "var(--status-warn)"
                    : deploy.state === "failed" ? "var(--status-bad)"
                    : deploy.state === "stale" ? "var(--status-warn)"
                    : "var(--nav-ink-mute)",
                  animation: deploy.state === "building" ? "pulse 2s ease-in-out infinite" : undefined,
                }}
              />
              {/* Branch before sha. `main` and `release` produce identical-
                  looking shas, and which of the two you are on is the thing
                  that decides whether what you are seeing reached users. */}
              <span
                style={{
                  ...MONO, fontSize: 10.5, letterSpacing: "0.04em",
                  color: deploy.branch === "release" ? "var(--nav-ink)" : undefined,
                  fontWeight: deploy.branch === "release" ? 600 : undefined,
                }}
              >
                {deploy.branch}
              </span>
              <span style={{ ...MONO, fontSize: 10.5, letterSpacing: "0.04em", opacity: 0.55 }}>·</span>
              <span style={{ ...MONO, fontSize: 10.5, letterSpacing: "0.04em" }}>{deploy.version}</span>
              {/* When the newest build is not this one, its short sha is the
                  thing worth reading — the running version alone would say
                  everything is fine. Carry its branch too when it differs,
                  because otherwise the arrow reads as "you are behind" when
                  it is pointing at a different line of work entirely. */}
              {deploy.latest ? (
                <span style={{ ...MONO, fontSize: 10.5, letterSpacing: "0.04em", opacity: 0.75 }}>
                  → {deploy.latestBranch ? `${deploy.latestBranch}·` : ""}{deploy.latest}
                </span>
              ) : null}
            </Tag>
              );
            })()}
          </>
        ) : null}

        <Rule />

        {on ? (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0 8px", flexShrink: 0 }}>
              <ToolButton tool="select" active={tool === "select"} onPick={setTool} label={copyText("site.platform.sitedock.label-2")} icon={<MousePointerSquareDashed size={13} />} />
              <ToolButton tool="draw" active={tool === "draw"} onPick={setTool} label={copyText("site.platform.sitedock.label-3")} icon={<SquareDashed size={13} />} />
            </div>
            <Rule />
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, padding: "0 14px", alignSelf: "center", fontSize: 12, color: "var(--nav-ink-faded)", flexShrink: 0 }}>
              <T id="site.platform.sitedock.span-5" v={{ notes: notes.length, v: notes.length === 1 ? "" : "s" }} c={[<span style={{ ...MONO, fontWeight: 500, color: "var(--nav-ink)" }} />]} />
            </span>
            <Rule />
            <button type="button" onClick={() => setOn(false)} style={{ ...SEGMENT_BTN, padding: "0 16px", color: "var(--nav-ink-soft)" }}><T id="site.platform.sitedock.button-6" /></button>
          </>
        ) : (
          <>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 12, padding: "0 14px", flexShrink: 0 }}>
              <Count value={stats?.total} label="shipped" tone="var(--nav-ink)" />
              {/* Waiting work is the number a reader wants; shipped is the number that
                  proves the promise. Both, or the row is a promise with no evidence. */}
              <Count value={stats?.open} label="waiting" tone="var(--status-warn)" />
            </div>
            {canDesign && (
              <>
                <Rule />
                <button
                  type="button"
                  onClick={() => setOn(true)}
                  title={copyText("site.platform.sitedock.title-3")}
                  style={{ ...SEGMENT_BTN, gap: 7, padding: "0 14px", color: "var(--nav-ink-soft)" }}
                >
                  <T id="site.platform.sitedock.button-7" c={[<Wand2 size={14} />, <span style={{ ...MONO, fontSize: 9.5, padding: "1px 4px", border: "1px solid var(--nav-ink-mute)", borderRadius: 3, color: "var(--nav-ink-faded)" }} />]} />
                </button>
              </>
            )}
            {isSiteAdmin && (
              <>
                <Rule />
                <button
                  type="button"
                  onClick={() => setAsPanel((v) => !v)}
                  title={borrowed ? copyText("site.platform.sitedock.button-8", { viewingAs }) : copyText("site.platform.sitedock.button-9")}
                  style={{
                    ...SEGMENT_BTN, gap: 7, padding: "0 14px",
                    background: borrowed ? "var(--status-warn)" : "transparent",
                    color: borrowed ? BG : "var(--nav-ink-soft)",
                    fontWeight: borrowed ? 600 : 400,
                  }}
                >
                  <Eye size={14} />
                  {borrowed ? viewingAs : copyText("site.platform.sitedock.button-10")}
                </button>
              </>
            )}
            <Rule />
            <Link href="/wishes" style={{ ...SEGMENT_BTN, gap: 6, padding: "0 16px", background: "var(--nav-ink)", color: BG, textDecoration: "none" }}>
              <T id="site.platform.sitedock.link-3" c={[<ArrowRight size={12} strokeWidth={2.5} />]} />
            </Link>
          </>
        )}
      </div>
    </>
  );
}

const BG = "var(--nav-bg)";
const EDGE = "rgba(246,242,234,0.12)";
const IVY = "var(--status-ok)";
const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)" };

const SEGMENT_BTN: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", height: "100%",
  border: "none", background: "transparent",
  fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600,
  cursor: "pointer", flexShrink: 0,
};

function Rule() {
  return <span aria-hidden style={{ width: 1, background: "var(--nav-rule)", flexShrink: 0 }} />;
}

function Count({ value, label, tone }: { value?: number; label: string; tone: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 5, fontSize: 12, color: "var(--nav-ink-faded)" }}>
      <span style={{ ...MONO, fontWeight: 500, color: tone }}>{value ?? "—"}</span>
      {label}
    </span>
  );
}

function ToolButton({ tool, active, onPick, label, icon }: { tool: Tool; active: boolean; onPick: (t: Tool) => void; label: string; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onPick(tool)}
      aria-pressed={active}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6,
        height: 28, padding: "0 11px", borderRadius: 8, border: "none",
        background: active ? IVY : "transparent",
        color: active ? "#fff" : "var(--nav-ink-soft)",
        fontFamily: "var(--font-sans)", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/**
 * The payment-mode chip. Clicking it moves THIS BROWSER to the other Stripe —
 * a session cookie an admin's own checkouts follow — and never the site's
 * switch, which lives in Settings → Billing. Clicking back to the site's own
 * mode clears the override rather than pinning it, so nothing lingers.
 */
function PaymentSegment({ mode, siteMode, override, switchable, live }: {
  mode: "live" | "test";
  siteMode: "live" | "test";
  override: boolean;
  switchable: boolean;
  live: boolean;
}) {
  const { T, t: copyText } = useCopy();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = live ? copyText("site.platform.sitedock.label-4") : copyText("site.platform.sitedock.link-2");
  const style = { display: "inline-flex", alignItems: "center", gap: 6, ...MONO, fontSize: 10.5, letterSpacing: "0.06em", textDecoration: "none", color: live ? "#fff" : "var(--nav-ink-faded)", fontWeight: live ? 600 : 400 } as const;
  const dot = <span style={{ width: 6, height: 6, borderRadius: 999, background: live ? "#fff" : "#6f8a76" }} />;

  async function toggle() {
    const next = mode === "live" ? "test" : "live";
    // Back to what the site does → drop the cookie; away from it → set it.
    const body = next === siteMode ? { action: "set-session-mode", mode: null } : { action: "set-session-mode", mode: next };
    if (next === "live" && !window.confirm(copyText("site.platform.sitedock.s-2"))) return;
    setBusy(true);
    const res = await fetch("/api/admin/billing", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(j.error ?? copyText("site.platform.sitedock.s-3"));
      return;
    }
    router.refresh();
  }

  if (!switchable) {
    return (
      <Link href="/settings/billing" title={copyText("site.platform.sitedock.title-4")} style={style}>
        {dot}{label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      title={override
        ? copyText("site.platform.sitedock.button-11", { mode, siteMode })
        : copyText("site.platform.sitedock.button-12", { mode })}
      style={{ ...style, background: "transparent", border: "none", padding: 0, cursor: busy ? "wait" : "pointer", font: "inherit" }}
    >
      {dot}{label}{override ? <span style={{ opacity: 0.8 }}><T id="site.platform.sitedock.span-6" /></span> : null}
    </button>
  );
}
