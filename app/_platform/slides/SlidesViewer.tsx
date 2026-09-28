"use client";

/**
 * The deck viewer — one slide at a time, keyboard-driven.
 *
 * Plain CSS and one piece of state, no reveal.js. A deck here is 20 slides of
 * repo-authored Markdown; pulling in a presentation framework to show them would
 * cost more bytes than the entire research site and buy nothing this needs.
 *
 * The slide surface is a 16:9 stage that scales with the viewport (`clamp` type,
 * container-relative padding) rather than a fixed pixel canvas, so it degrades to
 * a readable scrolling card on a phone instead of a shrunken unreadable one.
 * Every colour is a token — the deck inherits the product's accent from the shell.
 */
import React from "react";
import { parseDeck, renderSlide } from "./model";
import { useCopy } from "@/app/_platform/copy/client";

export function SlidesViewer({
  deck,
  downloadHref,
  backHref,
}: {
  deck: string;
  downloadHref?: string;
  backHref?: string;
}) {
  const { T, t } = useCopy();
  const slides = React.useMemo(() => parseDeck(deck), [deck]);
  const [i, setI] = React.useState(0);
  const count = slides.length;

  const go = React.useCallback(
    (next: number) => setI((cur) => Math.min(count - 1, Math.max(0, next))),
    [count],
  );

  React.useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      // Don't hijack the arrows while the reader is in a field or a menu.
      const el = ev.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (ev.key === "ArrowRight" || ev.key === "PageDown") {
        ev.preventDefault();
        setI((c) => Math.min(count - 1, c + 1));
      } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
        ev.preventDefault();
        setI((c) => Math.max(0, c - 1));
      } else if (ev.key === "Home") {
        ev.preventDefault();
        setI(0);
      } else if (ev.key === "End") {
        ev.preventDefault();
        setI(count - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  if (!count) {
    return (
      <div className="card">
        <p className="muted">
          <T id="site.platform.slides.slidesviewer.p-1" />
        </p>
      </div>
    );
  }

  const slide = slides[i];
  const html = renderSlide(slide);
  const atStart = i === 0;
  const atEnd = i === count - 1;

  return (
    <div className="deck">
      <style>{CSS}</style>

      <div className="deck-bar">
        {backHref ? (
          <a className="deck-back mono" href={backHref}>
            <T id="site.platform.slides.slidesviewer.a-1" />
          </a>
        ) : (
          <span />
        )}
        <div className="deck-bar-right">
          {downloadHref && (
            <a className="btn ghost deck-dl" href={downloadHref} download>
              <T id="site.platform.slides.slidesviewer.a-2" />
            </a>
          )}
        </div>
      </div>

      <section
        className="deck-stage"
        aria-roledescription="carousel"
        aria-label={t("site.platform.slides.slidesviewer.label-1")}
      >
        <article
          key={i}
          className="deck-canvas"
          aria-live="polite"
          aria-atomic="true"
          aria-label={t("site.platform.slides.slidesviewer.label-2", { i: i + 1, count, title: slide.title ? `: ${slide.title}` : "" })}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </section>

      <nav className="deck-nav" aria-label={t("site.platform.slides.slidesviewer.label-3")}>
        <button
          type="button"
          className="btn ghost"
          onClick={() => go(i - 1)}
          disabled={atStart}
          aria-label={t("site.platform.slides.slidesviewer.label-4")}
        >
          ←
        </button>

        <ol className="deck-dots" role="list">
          {slides.map((s, n) => (
            <li key={n}>
              <button
                type="button"
                className={`deck-dot${n === i ? " is-on" : ""}`}
                aria-label={t("site.platform.slides.slidesviewer.label-5", { n: n + 1, title: s.title ? `: ${s.title}` : "" })}
                aria-current={n === i ? "true" : undefined}
                onClick={() => go(n)}
              />
            </li>
          ))}
        </ol>

        <span className="deck-count mono" aria-hidden="true">
          {i + 1} / {count}
        </span>

        <button
          type="button"
          className="btn ghost"
          onClick={() => go(i + 1)}
          disabled={atEnd}
          aria-label={t("site.platform.slides.slidesviewer.label-6")}
        >
          →
        </button>
      </nav>
    </div>
  );
}

const CSS = `
.deck { display: flex; flex-direction: column; gap: 12px; }

.deck-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.deck-back { font-size: 12px; color: var(--ink-faded); text-decoration: none; }
.deck-back:hover { color: var(--accent); }
.deck-bar-right { display: flex; gap: 8px; }
.deck-dl { font-size: 12px; }

/* The stage. 16:9 where there is room; a scrolling card where there is not. */
.deck-stage {
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--bg-card, var(--bg));
  overflow: hidden;
  position: relative;
  /* The query container. It has to sit on the STAGE, not the canvas: an element
     cannot resolve cqw against itself, so the canvas's own padding (and every
     descendant's type size) would silently fall back to the clamp minimum. */
  container-type: inline-size;
}
.deck-canvas {
  aspect-ratio: 16 / 9;
  overflow-y: auto;
  padding: clamp(20px, 3.4cqw, 52px);
  display: flex;
  flex-direction: column;
  gap: 0.6em;
  animation: deck-in 160ms ease-out;
}
@keyframes deck-in { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .deck-canvas { animation: none; } }

/* Below the 16:9 breakpoint a phone would get ~90px of usable height. Let it
   grow instead — a readable tall slide beats a correct-ratio unreadable one. */
@media (max-width: 640px) {
  .deck-canvas { aspect-ratio: auto; min-height: 62vh; }
}

/* Slide type. The title slide (h1) is the only one that centres. */
.deck-canvas h1 {
  font-family: var(--font-serif);
  font-size: clamp(30px, 5.2cqw, 62px);
  line-height: 1.05;
  margin: auto 0 0;
  padding-left: 0.32em;
  border-left: 4px solid var(--accent);
}
.deck-canvas h1 ~ p { padding-left: calc(0.32em + 4px); }
.deck-canvas h1 ~ p:last-child { margin-bottom: auto; }

.deck-canvas h2 {
  font-family: var(--font-serif);
  font-size: clamp(21px, 3.3cqw, 38px);
  line-height: 1.16;
  color: var(--ink);
  padding-bottom: 0.4em;
  border-bottom: 1px solid var(--rule-soft);
  position: relative;
}
.deck-canvas h2::after {
  content: "";
  position: absolute;
  left: 0; bottom: -1px;
  width: 2.4em; height: 2px;
  background: var(--accent);
}
.deck-canvas h3 {
  font-family: var(--font-mono);
  font-size: clamp(10px, 1.25cqw, 13px);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-faded);
  margin-top: 0.5em;
}

.deck-canvas p { font-size: clamp(13px, 1.62cqw, 19px); line-height: 1.5; color: var(--ink-soft); margin: 0; }
.deck-canvas h1 ~ p { color: var(--ink-soft); }
.deck-canvas p em { color: var(--ink-faded); font-style: normal; font-family: var(--font-mono); font-size: 0.78em; }
.deck-canvas strong { color: var(--ink); font-weight: 600; }
.deck-canvas code { font-family: var(--font-mono); font-size: 0.88em; background: var(--bg-sunk); padding: 0.1em 0.36em; border-radius: var(--radius-sm); }
.deck-canvas a { color: var(--accent); }

.deck-canvas ul { margin: 0; padding-left: 1.1em; display: flex; flex-direction: column; gap: 0.42em; }
.deck-canvas li { font-size: clamp(13px, 1.55cqw, 18px); line-height: 1.45; color: var(--ink-soft); }
.deck-canvas li::marker { color: var(--accent); }

.deck-canvas table { width: 100%; border-collapse: collapse; font-size: clamp(11px, 1.32cqw, 15px); }
.deck-canvas th {
  text-align: left;
  font-family: var(--font-mono);
  font-size: 0.82em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-faded);
  background: var(--bg-sunk);
  padding: 0.5em 0.7em;
  border-bottom: 1px solid var(--rule);
  white-space: nowrap;
}
.deck-canvas td {
  padding: 0.5em 0.7em;
  border-bottom: 1px solid var(--rule-soft);
  color: var(--ink-soft);
  vertical-align: top;
}
.deck-canvas svg { max-width: 100%; height: auto; }

.deck-nav { display: flex; align-items: center; gap: 12px; }
.deck-nav .btn:disabled { opacity: 0.35; cursor: not-allowed; }
.deck-count { font-size: 12px; color: var(--ink-faded); margin-left: auto; }

.deck-dots { display: flex; align-items: center; gap: 5px; list-style: none; margin: 0; padding: 0; flex-wrap: wrap; }
.deck-dot {
  width: 9px; height: 9px; padding: 0;
  border-radius: 50%;
  border: 1px solid var(--rule);
  background: transparent;
  cursor: pointer;
}
.deck-dot:hover { border-color: var(--accent); }
.deck-dot.is-on { background: var(--accent); border-color: var(--accent); }
.deck-dot:focus-visible { outline: none; box-shadow: var(--focus-ring); }

@media (max-width: 640px) {
  .deck-dots { display: none; }
  .deck-count { margin-left: 0; }
  .deck-nav { justify-content: space-between; }
}
`;
