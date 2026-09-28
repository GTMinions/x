"use client";

/**
 * WishBoard — the wish surface. The only one.
 *
 * There used to be two. `WishlistRich` ran on a product's wishes page and could
 * submit, edit, vote, attach media, follow up. `/wishes` — the site's own page —
 * was hand-rolled, and could change a status and post a reply and nothing else:
 * no way to file a site wish at all, from the one page that existed to hold them.
 * So "wishes" meant a different thing depending on which page you were standing
 * on, and the site scope, the one every platform-level wish belongs to, was the
 * scope you could not file into.
 *
 * A wish is not a product feature. The flow — file, answer, rank, work, ship or
 * cancel, follow up — is the platform's, and it is the same flow whether the wish
 * is against a product or against the spine. So there is one component and it
 * takes the scope as a prop. A product page passes its slug and gets its own
 * accent from ProductShell's token register; the site page passes "site" and, for
 * an admin, a scope switcher over every other board. Nothing else differs, and
 * nothing else is allowed to: the next feature added here lands everywhere by
 * construction, which is the only way two surfaces stay in step.
 *
 *   <WishBoard scope="gtm" />              a product's board
 *   <WishBoard scope="site" crossScope />  the site's board, plus every other one
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowBigUp, Ban, Check, ChevronDown, ChevronUp, Clock, Film, FileText, Flag, Layers,
  Lightbulb, Loader2, Paperclip, Pencil, Plus, Receipt, X,
} from "lucide-react";
import { VoiceInputButton } from "./VoiceInputButton";
import { summarizeWish, extractWishes, type Candidate } from "@/app/lib/wishText";
import { STAGES, STAGE_IDS, isClosed, type WishStatus } from "./wishes/stages";
import type { Priority, Wish, WishComment, Media, Role } from "./wishes";
import { WishTimeline, type ReceiptPayload } from "./WishTimeline";
import { useCopy } from "@/app/_platform/copy/client";

/** Labels come from the stage table so the board cannot drift from the workflow.
 *  Tone is the board's own call: `triage` is the state a board exists to drain,
 *  so it gets its own register, and `bad` stays the failure register. */
const LABEL: Record<WishStatus, string> = Object.fromEntries(
  STAGES.map((s) => [s.id, s.label]),
) as Record<WishStatus, string>;
const TONE: Record<WishStatus, string> = {
  triage: "warn", backlog: "", ready: "info", building: "info",
  review: "warn", done: "ok", declined: "", duplicate: "",
};
const STATUSES: WishStatus[] = STAGE_IDS;
const TABS: { key: "all" | WishStatus; label: string }[] = [
  // Copy ids: the words come from the site copy at render time (useCopy in the component).
  { key: "all", label: "site.platform.wishboard.tab-1" },
  ...STATUSES.map((s) => ({ key: s, label: LABEL[s] })),
];
const PRIORITY_LABEL: Record<"p0" | "p1" | "p2", string> = { p0: "site.platform.wishboard.priority-1", p1: "site.platform.wishboard.priority-2", p2: "site.platform.wishboard.priority-3" };
/** P0 is the only rank that earns the alarm colour. Painting all three red would
 *  make the word "priority" mean nothing, which is how every backlog dies. */
const PRIORITY_TONE: Record<"p0" | "p1" | "p2", string> = { p0: "bad", p1: "warn", p2: "" };
const LEVELS = ["p0", "p1", "p2"] as const;

const MAX_RAW = 4_300_000;
const closedStatus = (s: WishStatus) => isClosed(s);

type StoreInfo = { mode: "db" | "memory" | "unknown"; persisted: boolean; scopes?: string[]; error: string | null };
type Feed = { wishes: Wish[]; isAdmin: boolean; store: StoreInfo };

export function WishBoard({
  scope,
  crossScope = false,
  heading,
}: {
  scope: string;
  /** Site board only: let an admin view and act on every product's board too. */
  crossScope?: boolean;
  heading?: string;
}) {
  const { T, t: copyText } = useCopy();
  heading ??= copyText("site.platform.wishboard.heading-1");
  const [feed, setFeed] = useState<Feed | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [view, setView] = useState(scope); // the board being looked at; "all" spans every scope
  const [tab, setTab] = useState<"all" | WishStatus>("all");
  const [author, setAuthor] = useState("all");
  const [composing, setComposing] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const scrolled = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/wishes?scope=${encodeURIComponent(crossScope ? "all" : scope)}`, { cache: "no-store" });
      const j = (await r.json()) as Feed;
      setFeed({ wishes: j.wishes ?? [], isAdmin: !!j.isAdmin, store: j.store });
    } catch {
      // The board keeps whatever it last had rather than blanking. A failed poll
      // is not evidence the wishes are gone.
      //
      // And on the FIRST load, when there is nothing to keep, it must not invent a
      // store either. This used to fall back to `mode: "memory"`, which made a
      // single network blip tell a reader on a GitHub-backed board that a restart
      // would delete every wish they could see. That is the exact lie StoreLine
      // exists to prevent, told by the component that prevents it. Not reaching the
      // store is not the same as knowing the store is memory.
      setFeed((f) => f ?? { wishes: [], isAdmin: false, store: { mode: "unknown", persisted: false, repo: null, error: null } });
    }
  }, [scope, crossScope]);

  useEffect(() => {
    load();
    const id = setInterval(load, 12_000);
    return () => clearInterval(id);
  }, [load]);
  useEffect(() => {
    fetch("/api/whoami").then((r) => r.json()).then((j) => setMe(j?.nickname ?? null)).catch(() => {});
  }, []);
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("wish"));
    if (n > 0) setFocus(n);
  }, []);
  useEffect(() => {
    if (!focus || !feed || scrolled.current) return;
    const el = document.getElementById(`wish-${focus}`);
    if (el) {
      scrolled.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focus, feed]);

  const all = useMemo(() => feed?.wishes ?? [], [feed]);
  const isAdmin = !!feed?.isAdmin;

  // Which board is on screen. Without crossScope there is only ever one.
  const scopes = useMemo(() => [...new Set(all.map((w) => w.scope))].sort(), [all]);
  const inView = useMemo(() => (view === "all" ? all : all.filter((w) => w.scope === view)), [all, view]);

  const authors = useMemo(() => [...new Set(inView.map((w) => w.nickname))].filter((a) => a !== me).sort(), [inView, me]);
  const byAuthor = (w: Wish) => author === "all" || w.nickname === author;
  const visible = inView.filter(byAuthor);
  const count = (k: "all" | WishStatus) => visible.filter((w) => k === "all" || w.status === k).length;
  const shown = visible.filter((w) => tab === "all" || w.status === tab);

  const open = inView.filter((w) => !closedStatus(w.status)).length;
  const waiting = inView.filter((w) => w.needsApproval && !closedStatus(w.status)).length;
  const ranked = inView.filter((w) => w.priority === "p0" && !closedStatus(w.status)).length;

  // Composing into "all" has no meaning — a wish is always against one scope — so
  // the composer falls back to this board's own scope.
  const composeScope = view === "all" ? scope : view;

  return (
    <section>
      <header style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
        <Lightbulb size={18} style={{ color: "var(--accent)" }} aria-hidden />
        <h2 style={{ margin: 0 }}>{heading}</h2>
        <span className="muted" style={{ fontSize: 13 }}><T id="site.platform.wishboard.span-7" /></span>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => setComposing(true)}>
          <T id="site.platform.wishboard.button-23" c={[<Plus size={14} aria-hidden />]} />
        </button>
      </header>

      {feed && <StoreLine store={feed.store} />}

      {inView.length > 0 && (
        <div className="grid cols-3" style={{ marginTop: "var(--space-5)" }}>
          <Tile label={copyText("site.platform.wishboard.label-17")} value={open} hint={copyText("site.platform.wishboard.hint-4", { inView: inView.length })} />
          <Tile label={copyText("site.platform.wishboard.label-18")} value={waiting} hint={copyText("site.platform.wishboard.hint-5")} />
          <Tile label="P0" value={ranked} hint={copyText("site.platform.wishboard.hint-6")} />
        </div>
      )}

      {crossScope && scopes.length > 1 && (
        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)", flexWrap: "wrap", alignItems: "center" }}>
          <span className="eyebrow"><T id="site.platform.wishboard.span-8" /></span>
          {[scope, ...scopes.filter((s) => s !== scope), "all"].map((s) => (
            <button
              key={s}
              onClick={() => setView(s)}
              className={`pill ${view === s ? "info" : ""}`}
              style={{ cursor: "pointer" }}
              aria-pressed={view === s}
            >
              {s === "all" ? copyText("site.platform.wishboard.button-24") : s === "site" ? copyText("site.platform.wishboard.button-25") : s}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--space-2)", margin: "var(--space-8) 0 var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`pill ${tab === t.key ? "info" : ""}`}
            style={{ cursor: "pointer" }}
            aria-pressed={tab === t.key}
          >
            {t.key === "all" ? copyText(t.label) : t.label}{count(t.key) ? ` ${count(t.key)}` : ""}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <label className="eyebrow" htmlFor="wish-author"><T id="site.platform.wishboard.label-19" /></label>
        <select id="wish-author" className="field" value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="all"><T id="site.platform.wishboard.option-4" /></option>
          {me && <option value={me}><T id="site.platform.wishboard.option-5" v={{ me }} /></option>}
          {authors.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {feed === null ? (
        <p className="muted" style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <T id="site.platform.wishboard.p-8" c={[<Loader2 size={14} className="spin" aria-hidden />]} />
        </p>
      ) : shown.length === 0 ? (
        <div className="card empty">
          <p style={{ margin: 0 }}>
            {inView.length === 0 ? copyText("site.platform.wishboard.p-9") : copyText("site.platform.wishboard.p-10", { LABEL: LABEL[tab as WishStatus]?.toLowerCase() ?? "shown" })}
          </p>
          <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: 13 }}>
            {inView.length === 0
              ? copyText("site.platform.wishboard.p-11")
              : copyText("site.platform.wishboard.p-12")}
          </p>
        </div>
      ) : (
        <div className="grid">
          {shown.map((w) => (
            <WishCard
              key={w.id}
              w={w}
              me={me}
              isAdmin={isAdmin}
              showScope={view === "all"}
              focus={focus === w.id}
              onMutate={load}
            />
          ))}
        </div>
      )}

      {composing && <Composer scope={composeScope} onClose={() => setComposing(false)} onDone={load} />}
    </section>
  );
}

function Tile({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="card">
      <div className="eyebrow">{label}</div>
      <div style={{ fontSize: 30, fontWeight: 600, marginTop: "var(--space-1)" }}>{value}</div>
      <div className="muted" style={{ fontSize: 13 }}>{hint}</div>
    </div>
  );
}

/**
 * Where the wishes are being kept, in one sentence.
 *
 * x runs with no secrets, and in that mode a wish lives in a module array that
 * the next cold start empties. A board that hides that from the person who just
 * filed a wish is worse than no board. The state rides on a rule down the left
 * edge rather than on tinted text: --status-warn on its own background clears
 * 2.6:1, which is fine for a two-word pill and fails AA for a sentence.
 */
function StoreLine({ store }: { store: StoreInfo }) {
  const { T } = useCopy();
  const held: "db" | "unreachable" | "memory" | "unknown" =
    store.mode === "unknown" ? "unknown" : store.error ? "unreachable" : store.persisted ? "db" : "memory";
  // `unknown` is an admission of ignorance, not a durability warning: it must not
  // reuse the amber the "every wish below is gone" branch uses.
  const tone =
    held === "unreachable" ? "bad" : held === "db" ? "ok" : held === "unknown" ? "info" : "warn";

  return (
    <div
      style={{
        marginTop: "var(--space-4)",
        padding: "var(--space-3) var(--space-4)",
        borderLeft: `3px solid var(--status-${tone})`,
        borderRadius: "var(--radius-sm)",
        background: `var(--status-${tone}-bg)`,
        color: "var(--ink-soft)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {held === "unknown" ? (
        <>
          <T id="site.platform.wishboard.fragment-5" />
        </>
      ) : held === "unreachable" ? (
        <>
          <T id="site.platform.wishboard.fragment-6" v={{ error: store.error }} />
        </>
      ) : held === "db" ? (
        <>
          <T id="site.platform.wishboard.fragment-7" />
        </>
      ) : (
        <>
          <T id="site.platform.wishboard.fragment-8" c={[<span className="mono" />]} />
        </>
      )}
    </div>
  );
}

function WishCard({
  w, me, isAdmin, showScope, focus, onMutate,
}: {
  w: Wish; me: string | null; isAdmin: boolean; showScope: boolean; focus: boolean; onMutate: () => void;
}) {
  const { T, t: copyText } = useCopy();
  const [open, setOpen] = useState(focus);
  const [receipt, setReceipt] = useState<ReceiptPayload | null>(null);
  const [acting, setActing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [eTitle, setETitle] = useState(w.title);
  const [eBody, setEBody] = useState(w.body);
  const [draft, setDraft] = useState("");
  const [drafting, setDrafting] = useState<null | "comment" | "followup" | "cancel">(null);

  const closed = closedStatus(w.status);
  const mine = !!me && me === w.nickname;
  /** An author owns their own wish; an admin owns the board. Between them they
   *  cover every action, and a reader who is neither can still vote and comment. */
  const canManage = mine || isAdmin;

  const pull = useCallback(async () => {
    try {
      const r = await fetch(`/api/wishes/${w.id}/receipt`, { cache: "no-store" });
      setReceipt(await r.json());
    } catch {
      setReceipt(null);
    }
  }, [w.id]);

  useEffect(() => {
    if (open && receipt === null) pull();
  }, [open, receipt, pull]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setActing(true);
    try {
      await fetch(`/api/wishes/${w.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      setReceipt(null);
      if (open) await pull();
      onMutate();
    } finally {
      setActing(false);
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text && drafting !== "cancel") return;
    if (drafting === "comment") await act("comment", { text });
    if (drafting === "followup") {
      setActing(true);
      try {
        await fetch(`/api/wishes/${w.id}/followup`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        setReceipt(null);
        onMutate();
      } finally {
        setActing(false);
      }
    }
    if (drafting === "cancel") await act("cancel", { reason: text });
    setDraft("");
    setDrafting(null);
    setOpen(true);
  }

  const prompt: Record<"comment" | "followup" | "cancel", string> = {
    comment: copyText("site.platform.wishboard.comment-2"),
    followup: copyText("site.platform.wishboard.followup-2"),
    cancel: copyText("site.platform.wishboard.cancel-2"),
  };

  return (
    <article
      id={`wish-${w.id}`}
      className="card"
      style={{ display: "flex", gap: "var(--space-4)", outline: focus ? "2px solid var(--accent)" : undefined, outlineOffset: 2 }}
    >
      <button onClick={() => act("upvote")} title={copyText("site.platform.wishboard.title-3")} aria-label={copyText("site.platform.wishboard.label-20", { votes: w.votes })} style={voteStyle}>
        <ArrowBigUp size={16} aria-hidden />
        <span style={{ fontSize: 12, fontWeight: 700 }}>{w.votes}</span>
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Only the pills that carry signal ride on the title: status, rank, and
            the fact that it is blocked. Role, scope and follow-up count are facts
            about the wish, not states to scan for — they sit in the footer with
            the author and the date. Seven identical capsules on one line is the
            same as none: the status pill has to out-weigh the "PM" tag. */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <span className="mono muted" style={{ fontSize: 12 }}>#{w.id}</span>
          <strong style={{ flex: 1, minWidth: 180 }}>{w.title}</strong>
          {w.priority && <span className={`pill ${PRIORITY_TONE[w.priority]}`}><Flag size={11} aria-hidden /> {copyText(PRIORITY_LABEL[w.priority])}</span>}
          <span className={`pill ${TONE[w.status]}`}>{LABEL[w.status]}</span>
          {w.needsApproval && !closed && <span className="pill warn"><T id="site.platform.wishboard.span-9" c={[<Clock size={11} aria-hidden />]} /></span>}
          {/* Derived, not stored: the pill disappears on its own when the
              blocker closes, because nothing here reads a "blocked" stage. */}
          {typeof w.blockedBy === "number" && !closed && (
            <span className="pill warn"><T id="site.platform.wishboard.span-10" v={{ blockedBy: w.blockedBy }} /></span>
          )}
          {w.publicWish && <span className="pill"><T id="site.platform.wishboard.span-11" /></span>}
        </div>

        {w.body && !editing && (
          <p className="muted" style={{ margin: "var(--space-2) 0 0", fontSize: 13, whiteSpace: "pre-wrap" }}>{w.body}</p>
        )}

        {w.media.length > 0 && (
          <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
            {w.media.map((m, i) =>
              m.type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={m.url} alt={m.name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: "var(--radius-sm)", border: "1px solid var(--rule)" }} />
              ) : (
                <a key={i} href={m.url} download={m.name} className="pill">
                  {m.type.startsWith("video/") ? <Film size={12} aria-hidden /> : <FileText size={12} aria-hidden />} {m.name}
                </a>
              ),
            )}
          </div>
        )}

        {editing && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <input className="field" style={{ width: "100%" }} value={eTitle} onChange={(e) => setETitle(e.target.value)} aria-label={copyText("site.platform.wishboard.label-21")} />
            <textarea className="field" style={{ width: "100%", minHeight: 60, marginTop: "var(--space-2)", resize: "vertical" }} value={eBody} onChange={(e) => setEBody(e.target.value)} aria-label={copyText("site.platform.wishboard.label-22")} />
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <button className="btn" onClick={() => { act("modify", { title: eTitle, body: eBody }); setEditing(false); }}><T id="site.platform.wishboard.button-26" /></button>
              <button className="btn ghost" onClick={() => setEditing(false)}><T id="site.platform.wishboard.button-27" /></button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <button className="btn ghost" style={sm} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            <T id="site.platform.wishboard.button-28" v={{ node: open ? <ChevronUp size={13} aria-hidden /> : <ChevronDown size={13} aria-hidden /> }} />
          </button>
          <button className="btn ghost" style={sm} onClick={() => { setDrafting("comment"); setDraft(""); }}><T id="site.platform.wishboard.button-29" /></button>

          {closed && <button className="btn ghost" style={sm} onClick={() => { setDrafting("followup"); setDraft(""); }}><T id="site.platform.wishboard.button-30" /></button>}

          {isAdmin && w.needsApproval && !closed && (
            <>
              <button className="btn" style={sm} disabled={acting} onClick={() => act("approve")}><T id="site.platform.wishboard.button-31" c={[<Check size={13} aria-hidden />]} /></button>
              <button className="btn ghost" style={sm} disabled={acting} onClick={() => act("reject")}><T id="site.platform.wishboard.button-32" c={[<Ban size={13} aria-hidden />]} /></button>
            </>
          )}

          {/* Publishing is reversible and the decision often comes later than
              the approval — a wish becomes worth showing once it ships. So the
              switch lives on the card too, not only in the review queue. */}
          {isAdmin && w.scope === "site" && (
            <button
              className="btn ghost"
              style={sm}
              disabled={acting}
              onClick={() => act("publish", { public: !w.publicWish })}
            >
              {w.publicWish ? copyText("site.platform.wishboard.button-33") : copyText("site.platform.wishboard.button-34")}
            </button>
          )}

          {canManage && !closed && !editing && (
            <button className="btn ghost" style={sm} onClick={() => { setETitle(w.title); setEBody(w.body); setEditing(true); }}>
              <T id="site.platform.wishboard.button-35" c={[<Pencil size={13} aria-hidden />]} />
            </button>
          )}
          {canManage && !closed && (
            <button className="btn ghost" style={sm} disabled={acting} onClick={() => { setDrafting("cancel"); setDraft(""); }}>
              <T id="site.platform.wishboard.button-36" c={[<X size={13} aria-hidden />]} />
            </button>
          )}

          {/* Reader actions left, admin machinery right. Interleaved, the ten
              controls read as one undifferentiated queue and the two registers
              blur into each other. */}
          {isAdmin && !closed && (
            <>
              <span style={{ flex: 1 }} />
              <label className="eyebrow" htmlFor={`rank-${w.id}`}><T id="site.platform.wishboard.label-23" /></label>
              <select
                id={`rank-${w.id}`}
                className="field"
                value={w.priority ?? ""}
                disabled={acting}
                onChange={(e) => act("prioritize", { priority: e.target.value || null })}
              >
                <option value=""><T id="site.platform.wishboard.option-6" /></option>
                {LEVELS.map((p) => <option key={p} value={p}>{copyText(PRIORITY_LABEL[p])}</option>)}
              </select>

              <label className="eyebrow" htmlFor={`status-${w.id}`}><T id="site.platform.wishboard.label-24" /></label>
              <select
                id={`status-${w.id}`}
                className="field"
                value={w.status}
                disabled={acting}
                onChange={(e) => act("status", { status: e.target.value })}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
              </select>
            </>
          )}

          {acting && <Loader2 size={14} className="spin" role="img" aria-label={copyText("site.platform.wishboard.label-25")} />}
        </div>

        {drafting && (
          <div style={{ marginTop: "var(--space-3)" }}>
            <textarea
              className="field"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={prompt[drafting]}
              aria-label={prompt[drafting]}
              style={{ width: "100%", minHeight: 56, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-2)" }}>
              <button className="btn" onClick={send} disabled={acting || (drafting !== "cancel" && !draft.trim())}>
                {drafting === "followup" ? copyText("site.platform.wishboard.button-37") : drafting === "cancel" ? copyText("site.platform.wishboard.button-38") : copyText("site.platform.wishboard.button-39")}
              </button>
              <button className="btn ghost" onClick={() => { setDrafting(null); setDraft(""); }}><T id="site.platform.wishboard.button-40" /></button>
            </div>
          </div>
        )}

        {open && (
          <div style={{ marginTop: "var(--space-4)", borderTop: "1px solid var(--rule-soft)", paddingTop: "var(--space-4)" }}>
            <WishTimeline receipt={receipt} />
          </div>
        )}

        <div className="muted mono" style={{ fontSize: 11, marginTop: "var(--space-3)", display: "flex", gap: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
          <span>{w.nickname}</span>
          <span>{w.createdAt}</span>
          <span>{w.source}</span>
          <span>{w.role}</span>
          {showScope && <span>{w.scope === "site" ? copyText("site.platform.wishboard.span-12") : w.scope}</span>}
          {w.followups > 0 && (
            <span title={copyText("site.platform.wishboard.title-4", { followups: w.followups })} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <T id="site.platform.wishboard.span-13" v={{ followups: w.followups }} c={[<Layers size={11} aria-hidden />]} />
            </span>
          )}
          {w.issueUrl && <a href={w.issueUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}><T id="site.platform.wishboard.a-2" v={{ id: w.id }} /></a>}
        </div>
      </div>
    </article>
  );
}

function Composer({ scope, onClose, onDone }: { scope: string; onClose: () => void; onDone: () => void }) {
  const { T, t: copyText } = useCopy();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [role, setRole] = useState<Role>("PM");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [paywalled, setPaywalled] = useState(false);
  // The whole wish, not just its number: whether it is queued or waiting on a
  // reviewer is the thing the filer most needs told, and it is only knowable
  // from the response.
  const [filed, setFiled] = useState<Wish | null>(null);
  const [split, setSplit] = useState<{ site: number; reason: string } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [picks, setPicks] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState("");
  const summary = useMemo(() => (title || body ? summarizeWish(`${title} ${body}`) : null), [title, body]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  function onVoice(t: string) {
    setBody((b) => (b ? `${b} ` : "") + t);
    if (!title.trim()) setTitle(summarizeWish(t).title);
  }
  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (next.length >= 4) break;
      if (f.size > MAX_RAW) { setErr(copyText("site.platform.wishboard.s-8", { name: f.name })); continue; }
      next.push(f);
    }
    setFiles(next);
    setErr("");
  }
  async function readScript(f: File) {
    const c = extractWishes(await f.text());
    setCandidates(c);
    setPicks(new Set(c.map((_, i) => i)));
  }
  function splitCurrent() {
    const c = extractWishes(`${title}. ${body}`);
    setCandidates(c);
    setPicks(new Set(c.map((_, i) => i)));
  }

  async function uploadOne(f: File): Promise<Media> {
    const r = await fetch(`/api/wishes/upload?name=${encodeURIComponent(f.name)}&type=${encodeURIComponent(f.type || "")}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: f,
    });
    const j = await r.json();
    if (!r.ok || !j.url) throw new Error(j.error || "upload failed");
    return { name: f.name, type: f.type, url: j.url };
  }

  type Filed = { wish: Wish; split: { site: number; reason: string } | null };

  async function post(t: string, b: string, source: string, media: Media[] = []): Promise<Filed> {
    const r = await fetch("/api/wishes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope, title: t, body: b, role, source, media }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const e = new Error(j.error || "could not file it") as Error & { paywall?: boolean };
      // Carried through so the form can offer the way out instead of only
      // naming the wall.
      if (j.paywall) e.paywall = true;
      throw e;
    }
    return { wish: j.wish as Wish, split: (j.split ?? null) as { site: number; reason: string } | null };
  }

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    setErr("");
    setPaywalled(false);
    try {
      const media = await Promise.all(files.map(uploadOne));
      const { wish, split: platformHalf } = await post(title, body, "form", media);
      // The receipt starts here. Handing back the number is what tells the person
      // their click did something — and it is what the old form never did.
      setFiled(wish);
      setSplit(platformHalf);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : copyText("site.platform.wishboard.s-9"));
      setPaywalled(Boolean((e as { paywall?: boolean })?.paywall));
    } finally {
      setSaving(false);
    }
  }

  async function createMany() {
    setSaving(true);
    try {
      const chosen = candidates!.filter((_, i) => picks.has(i));
      for (let i = 0; i < chosen.length; i++) {
        setProgress(copyText("site.platform.wishboard.s-10", { i: i + 1, chosen: chosen.length }));
        await post(`[${chosen[i].kind === "bug" ? copyText("site.platform.wishboard.s-11") : copyText("site.platform.wishboard.s-12")}] ${chosen[i].title}`, chosen[i].raw, "split");
      }
      onDone();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : copyText("site.platform.wishboard.s-13"));
    } finally {
      setProgress("");
      setSaving(false);
    }
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div
        className="card"
        role="dialog"
        aria-modal="true"
        aria-label={copyText("site.platform.wishboard.label-26")}
        style={{ width: 560, maxWidth: "92vw", maxHeight: "88vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", marginBottom: "var(--space-4)" }}>
          <h3 style={{ margin: 0 }}>{filed ? copyText("site.platform.wishboard.h3-3") : copyText("site.platform.wishboard.h3-4")}</h3>
          {!filed && summary && <span className={`pill ${summary.kind === "bug" ? "warn" : "info"}`}>{summary.label}</span>}
          <span style={{ flex: 1 }} />
          <button className="btn ghost" style={sm} onClick={onClose} aria-label={copyText("site.platform.wishboard.label-27")}><X size={14} aria-hidden /></button>
        </div>

        {filed ? (
          <div>
            <p style={{ margin: 0 }}>
              {filed.needsApproval ? (
                <>
                  <T id="site.platform.wishboard.fragment-9" v={{ id: filed.id }} c={[<span className="mono" />, <strong />]} />
                </>
              ) : (
                <>
                  <T id="site.platform.wishboard.fragment-10" v={{ id: filed.id }} c={[<span className="mono" />]} />
                </>
              )}
            </p>
            {split ? (
              <p style={{ margin: "var(--space-3) 0 0" }}>
                <T id="site.platform.wishboard.p-13" v={{ site: split.site, reason: split.reason, id: filed.id }} c={[<span className="mono" />, <span className="mono" />]} />
              </p>
            ) : null}
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
              <Link className="btn" href={`${scope === "site" ? "" : `/${scope}`}/wishes?wish=${filed.id}`} onClick={onClose}>
                <T id="site.platform.wishboard.link-2" c={[<Receipt size={14} aria-hidden />]} />
              </Link>
              <button className="btn ghost" onClick={() => { setFiled(null); setSplit(null); setTitle(""); setBody(""); setFiles([]); }}><T id="site.platform.wishboard.button-41" /></button>
            </div>
          </div>
        ) : candidates ? (
          <div>
            <div className="eyebrow" style={{ marginBottom: "var(--space-3)" }}><T id="site.platform.wishboard.div-3" v={{ candidates: candidates.length }} /></div>
            {candidates.length === 0 && <p className="muted"><T id="site.platform.wishboard.p-14" /></p>}
            {candidates.map((c, i) => (
              <label key={i} style={{ display: "flex", gap: "var(--space-2)", alignItems: "start", padding: "var(--space-2) 0", borderTop: i ? "1px solid var(--rule-soft)" : "none" }}>
                <input
                  type="checkbox"
                  checked={picks.has(i)}
                  onChange={(e) => {
                    const n = new Set(picks);
                    if (e.target.checked) n.add(i); else n.delete(i);
                    setPicks(n);
                  }}
                />
                <span><span className={`pill ${c.kind === "bug" ? "warn" : "info"}`}>{c.kind}</span> {c.title}</span>
              </label>
            ))}
            {err && (
              <Alert>
                {err}
                {paywalled && (
                  <>
                    {" "}
                    <a href="/get-started#tiers" style={{ fontWeight: 600 }}><T id="site.platform.wishboard.a-3" /></a>
                  </>
                )}
              </Alert>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
              <button className="btn" disabled={saving || picks.size === 0} onClick={createMany}>{progress || copyText("site.platform.wishboard.button-42", { picks: picks.size })}</button>
              <button className="btn ghost" onClick={() => setCandidates(null)}><T id="site.platform.wishboard.button-43" /></button>
            </div>
          </div>
        ) : (
          <>
            <input
              className="field"
              style={{ width: "100%" }}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              placeholder={copyText("site.platform.wishboard.placeholder-3")}
              aria-label={copyText("site.platform.wishboard.label-28")}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "start", marginTop: "var(--space-3)" }}>
              <textarea
                className="field"
                style={{ flex: 1, minHeight: 72, resize: "vertical" }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={copyText("site.platform.wishboard.placeholder-4")}
                aria-label={copyText("site.platform.wishboard.label-29")}
              />
              <VoiceInputButton onText={onVoice} />
            </div>

            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap", alignItems: "center" }}>
              <label className="btn ghost" style={{ ...sm, cursor: "pointer" }}>
                <T id="site.platform.wishboard.label-30" c={[<Paperclip size={13} aria-hidden />, <input type="file" multiple accept="image/*,video/*,.pdf,.doc,.docx,.md,.txt,.zip" hidden onChange={(e) => addFiles(e.target.files)} />]} />
              </label>
              <label className="btn ghost" style={{ ...sm, cursor: "pointer" }}>
                <T id="site.platform.wishboard.label-31" c={[<FileText size={13} aria-hidden />, <input type="file" accept=".txt,.md,.vtt,.srt" hidden onChange={(e) => e.target.files?.[0] && readScript(e.target.files[0])} />]} />
              </label>
              <button className="btn ghost" style={sm} onClick={splitCurrent} disabled={!title && !body}><T id="site.platform.wishboard.button-44" /></button>
              <span style={{ flex: 1 }} />
              <span className="eyebrow"><T id="site.platform.wishboard.span-14" /></span>
              {(["PM", "UX", copyText("site.platform.wishboard.div-4")] as Role[]).map((r) => (
                <button key={r} onClick={() => setRole(r)} className={`pill ${role === r ? "info" : ""}`} style={{ cursor: "pointer" }} aria-pressed={role === r}>{r}</button>
              ))}
            </div>

            {files.length > 0 && (
              <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)", flexWrap: "wrap" }}>
                {files.map((f, i) => (
                  <span key={i} className="pill">
                    {f.type.startsWith("image/") ? <Paperclip size={11} aria-hidden /> : f.type.startsWith("video/") ? <Film size={11} aria-hidden /> : <FileText size={11} aria-hidden />}
                    {f.name}
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={copyText("site.platform.wishboard.label-32", { name: f.name })} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-faded)", padding: 0 }}>
                      <X size={11} aria-hidden />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {err && (
              <Alert>
                {err}
                {paywalled && (
                  <>
                    {" "}
                    <a href="/get-started#tiers" style={{ fontWeight: 600 }}><T id="site.platform.wishboard.a-4" /></a>
                  </>
                )}
              </Alert>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-5)", justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={onClose}><T id="site.platform.wishboard.button-45" /></button>
              <button className="btn" onClick={submit} disabled={saving || !title.trim()}>
                <T id="site.platform.wishboard.button-46" v={{ saving: saving && <Loader2 size={14} className="spin" aria-hidden /> }} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const sm: React.CSSProperties = { padding: "var(--space-1) var(--space-3)", fontSize: 13 };

/** An error is a sentence, not a tag. `.pill` is an 11px capsule built for two
 *  words; the upload and governance messages are full sentences and the one
 *  message that must be heard was also the one with no `role="alert"`. */
function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="alert"
      style={{
        margin: "var(--space-3) 0 0",
        padding: "var(--space-3) var(--space-4)",
        borderLeft: "3px solid var(--status-bad)",
        borderRadius: "var(--radius-sm)",
        background: "var(--status-bad-bg)",
        color: "var(--status-bad)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {children}
    </p>
  );
}
const voteStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
  border: "1px solid var(--rule)", borderRadius: "var(--radius-sm)", background: "var(--bg-sunk)",
  cursor: "pointer", padding: "6px 10px", color: "var(--ink-soft)", height: "fit-content",
};
const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 200,
  background: "var(--scrim)", display: "grid", placeItems: "center", padding: "var(--space-5)",
};

export type { Wish, WishComment, WishStatus, Priority };
