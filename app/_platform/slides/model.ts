/**
 * The deck model — a deck is Markdown, slides split on a line that is exactly `---`.
 *
 * Markdown is the deck's source of truth rather than a JSON slide tree because a
 * deck has to survive three consumers that want different things: the viewer
 * wants HTML, the .pptx writer wants typed blocks, and a human wants to read the
 * diff. A string with a `---` separator satisfies all three and adds no schema.
 *
 * `parseDeck` does the structural work once (headings / bullets / tables / raw
 * HTML), so the renderer and the pptx writer consume the SAME blocks and cannot
 * drift apart. Pure and dependency-free — it runs in a server component, in a
 * client component, and in a build script.
 */

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "para"; text: string }
  /** Repo-authored markup (e.g. an entity's diagram_svg). Trusted, passed through. */
  | { kind: "html"; html: string };

export type Slide = {
  index: number;
  /** The raw Markdown chunk, kept so a deck round-trips without loss. */
  md: string;
  /** First heading on the slide, or "" — used for the counter rail and pptx alt-text. */
  title: string;
  blocks: Block[];
};

const SEPARATOR = /^\s*---\s*$/;

/** Split a deck into slides, parse each into blocks. Empty chunks are dropped. */
export function parseDeck(md: string): Slide[] {
  const chunks: string[] = [];
  let current: string[] = [];
  for (const line of md.replace(/\r\n/g, "\n").split("\n")) {
    if (SEPARATOR.test(line)) {
      chunks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  chunks.push(current.join("\n"));

  const slides: Slide[] = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    const blocks = parseBlocks(chunk);
    if (!blocks.length) continue;
    const heading = blocks.find((b) => b.kind === "heading");
    slides.push({
      index: slides.length,
      md: chunk.trim(),
      title: heading ? heading.text : "",
      blocks,
    });
  }
  return slides;
}

/** One slide chunk → typed blocks. Shared by the viewer and the pptx writer. */
export function parseBlocks(chunk: string): Block[] {
  const lines = chunk.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Heading — #, ##, ### (deeper levels clamp to 3).
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, text: heading[2].trim() });
      i++;
      continue;
    }

    // Table — a run of pipe rows. The `|---|---|` separator row is optional;
    // when present it is consumed rather than rendered as a body row.
    if (trimmed.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        rows.push(splitRow(lines[i].trim()));
        i++;
      }
      const isDivider = (cells: string[]) =>
        cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
      const body = rows.filter((r) => !isDivider(r));
      if (body.length) {
        const [head, ...rest] = body;
        blocks.push({ kind: "table", head, rows: rest });
      }
      continue;
    }

    // Bullets — a run of `-` or `*` items.
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "bullets", items });
      continue;
    }

    // Raw HTML — repo-authored markup (diagram_svg). Consume to a blank line.
    if (trimmed.startsWith("<")) {
      const html: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        html.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "html", html: html.join("\n") });
      continue;
    }

    // Paragraph — consume to a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || t.startsWith("|") || t.startsWith("<") || /^[-*]\s+/.test(t) || /^#{1,6}\s+/.test(t)) break;
      para.push(t);
      i++;
    }
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
  }

  return blocks;
}

function splitRow(line: string): string[] {
  // Drop the leading and trailing pipe, then split. Escaped \| stays literal.
  const inner = line.replace(/^\|/, "").replace(/\|$/, "");
  return inner
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, "|").trim());
}

/* ---------------------------------------------------------------------- */
/* Rendering                                                              */
/* ---------------------------------------------------------------------- */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * Inline Markdown → HTML: `code`, **bold**, _italic_, [text](url).
 *
 * Code spans are lifted out before the emphasis passes and put back after, so a
 * `snake_case_ident` inside backticks is not mangled into italics.
 */
export function renderInline(text: string): string {
  const code: string[] = [];
  // NUL sentinels cannot occur in deck text and pass through escapeHtml
  // untouched, so the restore pass can never collide with real content.
  let s = text.replace(/`([^`]+)`/g, (_m, inner: string) => {
    code.push(inner);
    return `\u0000${code.length - 1}\u0000`;
  });

  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label: string, href: string) => {
    return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Underscore italics only at a word boundary — protects file_names and URLs.
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=$|[\s).,;:!?])/g, "$1<em>$2</em>");

  return s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => `<code>${escapeHtml(code[Number(n)])}</code>`);
}

/**
 * A slide → an HTML fragment. Light on purpose: headings, bullets, tables,
 * paragraphs, and repo-authored HTML passed through. No sanitizer, because the
 * only input is a deck this repo generated from its own content.
 */
export function renderSlide(slide: Slide): string {
  const out: string[] = [];
  for (const b of slide.blocks) {
    switch (b.kind) {
      case "heading":
        out.push(`<h${b.level}>${renderInline(b.text)}</h${b.level}>`);
        break;
      case "para":
        out.push(`<p>${renderInline(b.text)}</p>`);
        break;
      case "bullets":
        out.push(`<ul>${b.items.map((it) => `<li>${renderInline(it)}</li>`).join("")}</ul>`);
        break;
      case "table": {
        const head = b.head.map((c) => `<th>${renderInline(c)}</th>`).join("");
        const rows = b.rows
          .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`)
          .join("");
        out.push(`<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`);
        break;
      }
      case "html":
        out.push(b.html);
        break;
    }
  }
  return out.join("\n");
}
