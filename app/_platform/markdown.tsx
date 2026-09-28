/**
 * A small markdown renderer for doctrine files — headings, paragraphs, lists,
 * tables, quotes, code, rules. It exists because the agent bodies are the only
 * markdown the platform renders, and a library would be a dependency and a
 * bundle for six block types.
 *
 * Every line is HTML-escaped before any tag is emitted, so a `<script>` in a
 * doctrine file renders as the literal text `<script>`.
 */
import React from "react";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Inline marks, applied to already-escaped text.
 *
 * Code is lifted out to a placeholder before the emphasis passes run and put back
 * after. A doctrine line like ``  `app/_platform/**` — the **research engine**  ``
 * carries a literal `**` inside its code span, and left in place it pairs with the
 * real bold that follows: the reader gets a strong tag opening mid-path and a
 * stray `**` hanging at the end of the line.
 */
function inline(src: string): string {
  const code: string[] = [];
  // NUL cannot appear in a doctrine file, so the placeholder cannot collide with prose.
  const marked = esc(src).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${code.push(c) - 1}\u0000`);
  return marked
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${code[Number(i)]}</code>`);
}

const html = (s: string) => ({ dangerouslySetInnerHTML: { __html: s } });
const cells = (row: string) => row.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

/** One line of markdown, inline marks only — for frontmatter text that carries `code`. */
export function InlineMd({ source }: { source: string }) {
  return <span {...html(inline(source))} />;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let lastWasRule = false;
  const key = () => `b${i}`;

  while (i < lines.length) {
    const line = lines[i];

    // Blank lines do not break a rule's run — `---`, blank, `---` is still two rules.
    if (!line.trim()) { i++; continue; }

    // A doctrine file often stacks `---` twice with a blank line between. Two rules
    // is never what the author meant, so a rule that follows a rule is dropped.
    const isRule = /^(-{3,}|\*{3,})\s*$/.test(line);
    if (isRule) {
      if (!lastWasRule) {
        out.push(<hr key={key()} className="md-hr" />);
        lastWasRule = true;
      }
      i++;
      continue;
    }
    lastWasRule = false;

    if (line.startsWith("```")) {
      const start = ++i;
      while (i < lines.length && !lines[i].startsWith("```")) i++;
      out.push(<pre key={start} className="md-pre"><code>{lines.slice(start, i).join("\n")}</code></pre>);
      i++;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      // The page already owns the h1, so the doctrine's own top level starts at h2.
      const Tag = (["h2", "h2", "h3", "h4", "h4", "h4"][h[1].length - 1]) as "h2" | "h3" | "h4";
      out.push(<Tag key={key()} className="md-h" {...html(inline(h[2]))} />);
      i++;
      continue;
    }

    if (line.startsWith("|")) {
      const start = i;
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const body = rows.filter((r) => !/^\|[\s:|-]+\|?$/.test(r));
      const [head, ...rest] = body;
      out.push(
        <div key={start} className="md-table-wrap">
          <table className="md-table">
            <thead><tr>{cells(head).map((c, n) => <th key={n} {...html(inline(c))} />)}</tr></thead>
            <tbody>
              {rest.map((r, n) => <tr key={n}>{cells(r).map((c, m) => <td key={m} {...html(inline(c))} />)}</tr>)}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (line.startsWith(">")) {
      const start = i;
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      out.push(<blockquote key={start} className="md-quote" {...html(inline(quote.join(" ")))} />);
      continue;
    }

    const bullet = /^\s*[-*+]\s+/;
    const number = /^\s*\d+[.)]\s+/;
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line);
      const mark = ordered ? number : bullet;
      const start = i;
      const items: string[] = [];
      while (i < lines.length && mark.test(lines[i])) items.push(lines[i++].replace(mark, ""));
      const List = ordered ? "ol" : "ul";
      out.push(
        <List key={start} className="md-list">
          {items.map((t, n) => <li key={n} {...html(inline(t))} />)}
        </List>,
      );
      continue;
    }

    // A paragraph runs until a line that opens some other block. Only ``` opens a
    // code block: a doctrine paragraph regularly starts on an inline span —
    // "`gateFor(entity)` computes what the next rung is missing" — and treating a
    // lone backtick as a block marker left that line matching no branch at all, so
    // the walk pushed an empty <p> and never advanced. The `para.length` guard is
    // the belt to that fix's braces: this run always consumes a line, whatever a
    // future block marker does.
    const start = i;
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^([#>|]|```|-{3,}|\s*[-*+]\s|\s*\d+[.)]\s)/.test(lines[i])) {
      para.push(lines[i++]);
    }
    if (!para.length) para.push(lines[i++]);
    out.push(<p key={start} className="md-p" {...html(inline(para.join(" ")))} />);
  }

  return <div className="md">{out}</div>;
}
