"use client";

/**
 * Search across one product's research corpus.
 *
 * 408 entities is a wall. The corpus index lists them alphabetically, which is an
 * ordering, not a way in — if you know the name you can scroll to it, and if you
 * don't, the site is closed to you.
 *
 * The index has existed all along (`public/search-index.json`, rebuilt every build)
 * and nothing read it. It does now.
 *
 * **Ranking is a linear scan, on purpose.** 408 documents against a query is a few
 * hundred microseconds; a real inverted index would be faster in a benchmark and
 * slower in practice, because it would need building, shipping, and keeping in
 * sync. The honest engineering at this size is the loop.
 *
 * Every result carries its **depth rung**. On a corpus that is mostly stubs, "we
 * have a page on it" and "we know something about it" are different answers, and a
 * reader should see which one they are about to get. A result list that hides that
 * sells the stub as the reference.
 */
import React from "react";
import { useRouter } from "next/navigation";
import { rungFor } from "./depth";
import { useCopy } from "@/app/_platform/copy/client";

type Doc = {
  slug: string;
  name: string;
  subtitle?: string;
  tags?: string[];
  depth: number;
  kind?: string;
  text: string;
};

type Hit = { doc: Doc; score: number };

/**
 * Where a match landed decides what it is worth.
 *
 * A query in the name is almost certainly the thing you meant; the same query
 * buried in 4,000 characters of prose almost certainly is not. The gaps between
 * these numbers are wide so a single name hit always outranks a pile of body hits.
 */
const W_NAME_EXACT = 1000;
const W_NAME_PREFIX = 600;
const W_NAME = 300;
const W_SUBTITLE = 60;
const W_TAG = 40;
const W_TEXT = 4;

function score(doc: Doc, q: string): number {
  const name = doc.name.toLowerCase();
  const slug = doc.slug.toLowerCase();
  let s = 0;

  if (name === q || slug === q) s += W_NAME_EXACT;
  else if (name.startsWith(q) || slug.startsWith(q)) s += W_NAME_PREFIX;
  else if (name.includes(q) || slug.includes(q)) s += W_NAME;

  if (doc.subtitle?.toLowerCase().includes(q)) s += W_SUBTITLE;
  for (const t of doc.tags ?? []) if (t.toLowerCase().includes(q)) s += W_TAG;

  if (s === 0 || doc.text) {
    // Count body hits, capped: a page that says the word thirty times is not thirty
    // times more relevant, it is just long.
    const hits = doc.text.toLowerCase().split(q).length - 1;
    s += Math.min(hits, 5) * W_TEXT;
  }
  return s;
}

export function ResearchSearch({ productSlug }: { productSlug: string }) {
  const { T, t: copyText } = useCopy();
  const router = useRouter();
  const [docs, setDocs] = React.useState<Doc[] | null>(null);
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // The index is fetched once, on first focus. Loading 408 docs for a reader who
  // never searches is a cost with no buyer.
  const load = React.useCallback(() => {
    if (docs) return;
    fetch("/search-index.json")
      .then((r) => r.json())
      .then((all: Record<string, Doc[]>) => setDocs(all[productSlug] ?? []))
      .catch(() => setDocs([]));
  }, [docs, productSlug]);

  const hits: Hit[] = React.useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!docs || query.length < 2) return [];
    return docs
      .map((doc) => ({ doc, score: score(doc, query) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score || b.doc.depth - a.doc.depth)
      .slice(0, 8);
  }, [docs, q]);

  React.useEffect(() => setCursor(0), [q]);

  // ⌘K / Ctrl-K from anywhere on the research site.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        load();
        setOpen(true);
        inputRef.current?.focus();
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [load]);

  React.useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(slug: string) {
    setOpen(false);
    setQ("");
    router.push(`/${productSlug}/research/${slug}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(hits[cursor].doc.slug);
    }
  }

  return (
    <div ref={boxRef} style={{ position: "relative", marginLeft: "auto" }}>
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="research-search-results"
        aria-label={copyText("site.platform.research.researchsearch.label-1")}
        placeholder={copyText("site.platform.research.researchsearch.placeholder-1")}
        value={q}
        onFocus={() => {
          load();
          setOpen(true);
        }}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKeyDown}
        style={{
          width: 210,
          height: 28,
          padding: "0 var(--space-3)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--rule)",
          background: "var(--bg-card)",
          color: "var(--ink)",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
        }}
      />

      {open && q.trim().length >= 2 && (
        <div
          id="research-search-results"
          role="listbox"
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            right: 0,
            width: 420,
            maxWidth: "90vw",
            maxHeight: 420,
            overflowY: "auto",
            background: "var(--bg-card)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--radius)",
            boxShadow: "var(--shadow-2)",
            padding: "var(--space-1)",
            zIndex: 60,
          }}
        >
          {!docs && (
            <p className="muted" style={{ margin: 0, padding: "var(--space-3)", fontSize: 13 }}>
              <T id="site.platform.research.researchsearch.p-1" />
            </p>
          )}

          {docs && hits.length === 0 && (
            <p className="muted" style={{ margin: 0, padding: "var(--space-3)", fontSize: 13 }}>
              <T id="site.platform.research.researchsearch.p-2" v={{ docs: docs.length, q }} c={[<strong />]} />
            </p>
          )}

          {hits.map((h, i) => {
            const rung = rungFor(h.doc.depth);
            const thin = h.doc.depth < 5;
            return (
              <button
                key={h.doc.slug}
                role="option"
                aria-selected={i === cursor}
                onClick={() => go(h.doc.slug)}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-sm)",
                  border: "none",
                  cursor: "pointer",
                  background: i === cursor ? "var(--accent-bg)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-2)" }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--ink)" }}>{h.doc.name}</span>
                  {h.doc.kind === "moc" && <span className="pill info"><T id="site.platform.research.researchsearch.span-1" /></span>}
                  <span style={{ flex: 1 }} />
                  {/* The rung, on every row. A stub and a reference-grade page are
                      different answers to the same query, and hiding that sells one
                      as the other. */}
                  <span
                    className="mono"
                    style={{ fontSize: 10, color: thin ? "var(--ink-mute)" : "var(--status-ok)" }}
                  >
                    {rung.label} {h.doc.depth}
                  </span>
                </div>
                {h.doc.subtitle && (
                  <div
                    className="muted"
                    style={{
                      fontSize: 12,
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.doc.subtitle}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
