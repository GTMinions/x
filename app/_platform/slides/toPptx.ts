/**
 * Deck (Markdown) → .pptx bytes.
 *
 * Runs in a Node route with no network and no OAuth: pptxgenjs assembles the
 * OOXML zip in-process, so the download is a real PowerPoint file the reader can
 * open, edit, and present — not a PDF of a web page.
 *
 * Layout is deterministic. The same deck always produces the same bytes-worth of
 * structure, because the geometry is a pure function of the parsed blocks: a
 * header band, then a body cursor that walks blocks top-down at a size chosen by
 * how much there is to fit. No heuristics that depend on wall-clock or ordering.
 *
 * ## On colour
 *
 * The design system's rule is "never hard-code a colour, use the CSS var". A
 * .pptx has no CSS, so the tokens have to be resolved to hex SOMEWHERE, and this
 * is the boundary where that happens — once, explicitly, from the Peel palette,
 * with `--accent` passed in by the caller from the product registry. The deck
 * therefore inherits the product's accent exactly like every other surface does.
 */
import pptxgen from "pptxgenjs";
import { parseDeck, type Block, type Slide } from "./model";

/**
 * Peel, resolved. Mirrors app/globals.css — the product register (parchment).
 * Fonts are the ubiquitous stand-ins for the web stack: PowerPoint cannot be
 * relied on to have Cormorant Garamond or Manrope installed, and a missing font
 * falls back to something worse than a deliberate choice. Georgia holds the
 * scholarly serif register; Calibri is the neutral body face.
 */
const INK = "262019";
const INK_SOFT = "4B4236";
const INK_FADED = "776B59";
const BG_SUNK = "F1ECE0";
const RULE = "E2D9C8";
const SERIF = "Georgia";
const SANS = "Calibri";
const MONO = "Consolas";

// LAYOUT_WIDE is 13.33in × 7.5in.
const W = 13.33;
const H = 7.5;
const MX = 0.75; // side margin
const CW = W - MX * 2; // content width
const BODY_TOP = 1.85;
const BODY_BOTTOM = H - 0.6;

export type PptxOptions = {
  /** The product's accent, as CSS gives it (`#356a4d`) or bare hex. */
  accent?: string;
  /** Deck subject/company metadata. */
  product?: string;
  title?: string;
};

function hex(color: string | undefined, fallback: string): string {
  if (!color) return fallback;
  const c = color.trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : fallback;
}

/* ---------------------------------------------------------------------- */
/* Inline Markdown → pptx rich-text runs                                  */
/* ---------------------------------------------------------------------- */

type Run = { text: string; options?: Record<string, unknown> };

/**
 * **bold**, _italic_, `code`, and [label](url) become real pptx runs, so a
 * citation on the Sources slide is a live hyperlink in PowerPoint rather than a
 * string of markup the reader has to squint through.
 */
function inlineRuns(text: string, base: Record<string, unknown>, accent: string): Run[] {
  const runs: Run[] = [];
  const pattern = /(\*\*[^*]+\*\*)|(`[^`]+`)|(\[[^\]]+\]\(https?:\/\/[^\s)]+\))|((?:^|(?<=[\s(]))_[^_\n]+_(?=$|[\s).,;:!?]))/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const push = (t: string, extra?: Record<string, unknown>) => {
    if (!t) return;
    runs.push({ text: t, options: { ...base, ...extra } });
  };

  while ((m = pattern.exec(text)) !== null) {
    push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) {
      push(tok.slice(2, -2), { bold: true });
    } else if (tok.startsWith("`")) {
      push(tok.slice(1, -1), { fontFace: MONO, fontSize: (base.fontSize as number) - 1 });
    } else if (tok.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(tok);
      if (link) push(link[1], { color: accent, hyperlink: { url: link[2] } });
    } else {
      const t = tok.trim();
      const lead = tok.slice(0, tok.length - tok.trimStart().length);
      push(lead);
      push(t.slice(1, -1), { italic: true });
    }
    last = m.index + tok.length;
  }
  push(text.slice(last));
  return runs.length ? runs : [{ text, options: base }];
}

/** Markdown inline syntax removed — for a table cell, which takes plain text. */
function plain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/\\\|/g, "|");
}

/* ---------------------------------------------------------------------- */
/* Height estimation — how the body decides its own type size             */
/* ---------------------------------------------------------------------- */

/** Rough rendered height of a block, in inches, at a given body size. */
function blockHeight(b: Block, size: number): number {
  const lineH = size / 58; // ~0.24in at 14pt
  const perLine = Math.max(40, Math.round(CW * 105 / size)); // chars per line
  switch (b.kind) {
    case "heading":
      return b.level === 3 ? lineH + 0.16 : lineH + 0.22;
    case "para":
      return Math.ceil(b.text.length / perLine) * lineH + 0.14;
    case "bullets":
      return b.items.reduce((h, it) => h + Math.ceil(it.length / perLine) * lineH + 0.08, 0) + 0.08;
    case "table":
      return (b.rows.length + 1) * (lineH + 0.14) + 0.16;
    case "html":
      return 0; // not rendered — see renderBody
  }
}

/* ---------------------------------------------------------------------- */
/* Slide rendering                                                        */
/* ---------------------------------------------------------------------- */

type Pres = InstanceType<typeof pptxgen>;
type PptxSlide = ReturnType<Pres["addSlide"]>;

function renderTitleSlide(slide: PptxSlide, blocks: Block[], accent: string) {
  const h1 = blocks.find((b) => b.kind === "heading" && b.level === 1);
  const rest = blocks.filter((b) => b !== h1);

  slide.addShape("rect", { x: 0, y: 0, w: 0.28, h: H, fill: { color: accent } });

  slide.addText(h1 && h1.kind === "heading" ? h1.text : "", {
    x: MX + 0.2, y: 2.3, w: CW - 0.2, h: 1.5,
    fontFace: SERIF, fontSize: 46, color: INK, bold: true, valign: "bottom",
  });

  let y = 3.9;
  for (const b of rest) {
    if (b.kind === "para") {
      const italic = /^_.*_$/.test(b.text.trim());
      slide.addText(inlineRuns(b.text, { fontFace: SANS, fontSize: italic ? 12 : 17, color: italic ? INK_FADED : INK_SOFT }, accent), {
        x: MX + 0.2, y, w: CW - 0.2, h: 0.4, valign: "top",
      });
      y += italic ? 0.42 : 0.5;
    }
  }
}

function renderBody(slide: PptxSlide, blocks: Block[], accent: string) {
  const head = blocks[0]?.kind === "heading" && blocks[0].level <= 2 ? blocks[0] : null;
  const body = head ? blocks.slice(1) : blocks;

  // Header band: accent rule + the slide's claim.
  if (head && head.kind === "heading") {
    slide.addText(head.text, {
      x: MX, y: 0.55, w: CW, h: 0.9,
      fontFace: SERIF, fontSize: 27, color: INK, bold: true, valign: "middle",
    });
    slide.addShape("rect", { x: MX, y: 1.52, w: 1.1, h: 0.045, fill: { color: accent } });
  }

  // Pick the body size that fits. Deterministic: the first size in the ladder
  // whose estimated height clears the frame, else the smallest.
  const avail = BODY_BOTTOM - (head ? BODY_TOP : 0.9);
  const sizes = [16, 14, 12, 11, 10];
  const size =
    sizes.find((s) => body.reduce((h, b) => h + blockHeight(b, s), 0) <= avail) ?? sizes[sizes.length - 1];

  let y = head ? BODY_TOP : 0.9;
  for (const b of body) {
    if (y > BODY_BOTTOM) break; // ran out of frame — the deck, not the slide, is the fix
    switch (b.kind) {
      case "heading": {
        slide.addText(b.text, {
          x: MX, y, w: CW, h: size / 48,
          fontFace: SANS, fontSize: size + 1, color: INK_FADED, bold: true,
          charSpacing: 1,
        });
        y += blockHeight(b, size);
        break;
      }
      case "para": {
        const h = blockHeight(b, size);
        slide.addText(inlineRuns(b.text, { fontFace: SANS, fontSize: size, color: INK_SOFT }, accent), {
          x: MX, y, w: CW, h, valign: "top", lineSpacingMultiple: 1.15,
        });
        y += h;
        break;
      }
      case "bullets": {
        const h = blockHeight(b, size);
        // pptxgenjs models a multi-paragraph text box as one flat run list:
        // the bullet rides on each item's FIRST run, and breakLine on its LAST.
        const runs = b.items.flatMap((it, i) => {
          const parts = inlineRuns(it, { fontFace: SANS, fontSize: size, color: INK_SOFT }, accent);
          return parts.map((r, j) => ({
            text: r.text,
            options: {
              ...r.options,
              ...(j === 0 ? { bullet: { code: "2022", indent: 12 } } : {}),
              ...(j === parts.length - 1 && i < b.items.length - 1 ? { breakLine: true } : {}),
            },
          }));
        });
        slide.addText(runs, { x: MX, y, w: CW, h, valign: "top", lineSpacingMultiple: 1.12 });
        y += h;
        break;
      }
      case "table": {
        const h = blockHeight(b, size);
        const fs = Math.max(9, size - 2);
        const rows = [
          b.head.map((c) => ({
            text: plain(c),
            options: { bold: true, color: INK, fill: { color: BG_SUNK }, fontSize: fs, fontFace: SANS },
          })),
          ...b.rows.map((r) =>
            r.map((c) => ({
              text: plain(c),
              options: { color: INK_SOFT, fontSize: fs, fontFace: SANS },
            })),
          ),
        ];
        slide.addTable(rows, {
          x: MX, y, w: CW,
          border: { type: "solid", color: RULE, pt: 0.5 },
          margin: 0.08,
          autoPage: false,
        });
        y += h;
        break;
      }
      case "html":
        // An entity's diagram_svg. The viewer draws it; there is no rasteriser in
        // a Node route, so the .pptx omits it rather than shipping a broken box.
        break;
    }
  }
}

/* ---------------------------------------------------------------------- */

/** Markdown deck → .pptx bytes. */
export async function deckToPptx(md: string, opts: PptxOptions = {}): Promise<Uint8Array> {
  const accent = hex(opts.accent, "356A4D");
  const slides: Slide[] = parseDeck(md);

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE";
  pres.title = opts.title ?? "Research deck";
  pres.subject = opts.title ?? "Research deck";
  pres.company = opts.product ?? "x";
  pres.author = opts.product ?? "x";

  for (const s of slides) {
    const slide = pres.addSlide();
    const isTitle = s.blocks.some((b) => b.kind === "heading" && b.level === 1);
    if (isTitle) renderTitleSlide(slide, s.blocks, accent);
    else renderBody(slide, s.blocks, accent);
  }

  if (!slides.length) {
    pres.addSlide().addText("This entity has no researched content yet.", {
      x: MX, y: 3, w: CW, h: 1, fontFace: SANS, fontSize: 18, color: INK_FADED,
    });
  }

  const out = (await pres.write({ outputType: "nodebuffer" })) as unknown as Buffer;
  return new Uint8Array(out);
}
