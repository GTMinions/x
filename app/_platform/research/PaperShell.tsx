/**
 * The paper register.
 *
 * A research entity at depth is a short paper, so it should read as one. That
 * means three things a card stack cannot give you:
 *
 *   **A measure.** Prose holds 68 characters. The same paragraph run full-width
 *   across a wide monitor is skimmed and abandoned; the column is not decoration.
 *
 *   **Numbered sections.** A reader can cite §4. A contents rail can point at it.
 *   Neither is possible when every block is an anonymous card.
 *
 *   **Numbered figures and tables.** Prose can then refer to Table 2 instead of
 *   "the table below", which stops being true the moment the layout reflows.
 *
 * Sections are collected as data and rendered from that one array, so the numbers
 * in the body and the numbers in the contents rail cannot drift apart — they are
 * computed from the same list. Sections whose content is absent are never added,
 * which is why a stub renders as a short paper rather than as a long one full of
 * empty headings.
 */
import React from "react";
import { T, t } from "@/app/_platform/copy";

export type PaperSectionSpec = {
  /** Anchor id. Also the contents-rail link target. */
  id: string;
  title: string;
  body: React.ReactNode;
};

/**
 * Collects sections, skipping any whose body is empty.
 *
 * The `push` returns nothing and the caller never sees an index — numbering is
 * assigned at render, from position. A section that decides its own number is a
 * section that gets it wrong the first time one above it is removed.
 */
export class Sections {
  private items: PaperSectionSpec[] = [];

  add(id: string, title: string, body: React.ReactNode | null | undefined | false): void {
    if (!body) return;
    this.items.push({ id, title, body });
  }

  get all(): PaperSectionSpec[] {
    return this.items;
  }
}

/** The sticky contents rail. Desktop only; it collapses out below 1080px. */
export function PaperToc({ sections }: { sections: PaperSectionSpec[] }) {
  if (sections.length < 2) return null;
  return (
    <nav className="paper-toc" aria-label={t("site.platform.research.papershell.label-1")}>
      <ol>
        {sections.map((s) => (
          <li key={s.id}>
            <a href={`#${s.id}`}>{s.title}</a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** One numbered section. The number comes from its position, nowhere else. */
export function PaperSection({
  n,
  spec,
  aside,
}: {
  n: number;
  spec: PaperSectionSpec;
  aside?: React.ReactNode;
}) {
  return (
    <section id={spec.id} className="paper-section">
      <h2>
        <span className="num">{n}</span>
        <span style={{ flex: 1 }}>{spec.title}</span>
        {aside}
      </h2>
      {spec.body}
    </section>
  );
}

/**
 * A figure. Numbered, captioned, and allowed to break the text measure.
 *
 * The caption sits below the figure and carries the number, which is the
 * convention every reader of a paper already knows — so it needs no explaining,
 * which is the whole argument for following a convention.
 */
export function Figure({
  n,
  caption,
  children,
}: {
  n: number;
  caption?: string;
  children: React.ReactNode;
}) {
  return (
    <figure className="paper-figure paper-wide">
      <div style={{ overflowX: "auto" }}>{children}</div>
      <figcaption className="paper-caption">
        <b><T id="site.platform.research.papershell.b-1" v={{ n }} /></b> {caption ?? ""}
      </figcaption>
    </figure>
  );
}

/** A table. Same contract as a figure: numbered, captioned, may bleed wider. */
export function Table({
  n,
  caption,
  children,
  note,
}: {
  n: number;
  caption?: string;
  children: React.ReactNode;
  /** A footnote under the table. Sits outside the scroll box, because prose wraps — it
   *  does not scroll sideways with the columns it is explaining. Takes a node, not a
   *  string, so the caller can run it through the pill renderer: a note that names another
   *  entity should link to it, and be gated like any other prose that does. Rendered into
   *  a `<div class="paper-note">`, which is what makes a multi-paragraph node legal here;
   *  see the class in globals.css for why a `<p>` wrapper silently destroyed the styling. */
  note?: React.ReactNode;
}) {
  return (
    <figure className="paper-wide paper-tablefig">
      <figcaption className="paper-caption">
        <b><T id="site.platform.research.papershell.b-2" v={{ n }} /></b> {caption ?? ""}
      </figcaption>
      <div style={{ overflowX: "auto" }}>{children}</div>
      {note && <div className="paper-note">{note}</div>}
    </figure>
  );
}

/**
 * A running counter for figures and tables.
 *
 * Kept as a mutable object rather than React state because the page is a server
 * component rendered once, top to bottom — the counter is just the order things
 * appeared in, which is exactly what a figure number means.
 */
export function counter() {
  let fig = 0;
  let tab = 0;
  return {
    fig: () => ++fig,
    tab: () => ++tab,
  };
}
