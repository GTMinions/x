/**
 * The copy template language — shared by the server store and the client hook.
 *
 * A copy row's value is plain text with two kinds of slot:
 *
 *   {{name}}          a value the page supplies at render time (a number, a
 *                     node, a string). Unknown names render as the literal
 *                     placeholder so a typo is visible, not silent.
 *   <0>…</0>  <1/>    an element the page supplies — a Link with its href, a
 *                     <code>, a <strong>. The row owns the words inside; the
 *                     code owns the tag and its attributes. Digits only, so a
 *                     stray "<" in prose is never mistaken for a slot.
 *
 * Why not markdown: the pages mix links, code and emphasis with arbitrary
 * attributes (className, href, style). A slot keeps every attribute in the
 * code, where the type checker can see it, and keeps every word in the row,
 * where an editor can change it without touching a .tsx file.
 */
import React, { type ReactNode, type ReactElement } from "react";

export type CopyVars = Record<string, ReactNode>;

type Token =
  | { kind: "text"; text: string }
  | { kind: "var"; name: string }
  | { kind: "el"; index: number; children: Token[] };

const SLOT_RE = /\{\{\s*([A-Za-z_$][\w$]*)\s*\}\}|<(\d+)\s*\/>|<(\d+)>|<\/(\d+)>/g;

/** Parse a template into a token tree. Unbalanced slot tags are kept as text. */
export function parseCopy(tpl: string): Token[] {
  const root: Token[] = [];
  const stack: { index: number; children: Token[] }[] = [];
  const top = () => (stack.length ? stack[stack.length - 1]!.children : root);
  let last = 0;
  for (const m of tpl.matchAll(SLOT_RE)) {
    const at = m.index ?? 0;
    if (at > last) top().push({ kind: "text", text: tpl.slice(last, at) });
    last = at + m[0].length;
    if (m[1] !== undefined) top().push({ kind: "var", name: m[1] });
    else if (m[2] !== undefined) top().push({ kind: "el", index: Number(m[2]), children: [] });
    else if (m[3] !== undefined) {
      const node = { kind: "el" as const, index: Number(m[3]), children: [] as Token[] };
      top().push(node);
      stack.push(node);
    } else if (m[4] !== undefined) {
      const open = stack.length ? stack[stack.length - 1]! : null;
      if (open && open.index === Number(m[4])) stack.pop();
      else top().push({ kind: "text", text: m[0] });
    }
  }
  if (last < tpl.length) top().push({ kind: "text", text: tpl.slice(last) });
  return root;
}

const asText = (v: ReactNode): string =>
  v == null || typeof v === "boolean" ? "" : typeof v === "object" ? "" : String(v);

/** Render to a plain string — for attributes (placeholder, title, aria-*) and metadata. */
export function renderCopyString(tpl: string, vars?: CopyVars): string {
  const walk = (tokens: Token[]): string =>
    tokens
      .map((t) =>
        t.kind === "text" ? t.text : t.kind === "var" ? (vars && t.name in vars ? asText(vars[t.name]) : `{{${t.name}}}`) : walk(t.children),
      )
      .join("");
  return walk(parseCopy(tpl));
}

/** Render to React nodes, filling element slots from `els` by index. */
export function renderCopyNodes(tpl: string, vars?: CopyVars, els?: ReactNode[]): ReactNode[] {
  let k = 0;
  const walk = (tokens: Token[]): ReactNode[] =>
    tokens.map((t) => {
      if (t.kind === "text") return t.text;
      if (t.kind === "var") return <React.Fragment key={k++}>{vars && t.name in vars ? vars[t.name] : `{{${t.name}}}`}</React.Fragment>;
      const el = els?.[t.index];
      const inner = walk(t.children);
      if (React.isValidElement(el)) {
        return React.cloneElement(el as ReactElement<{ children?: ReactNode }>, { key: k++ }, ...(inner.length ? inner : []));
      }
      // No element for this slot: render the words, drop the tag.
      return <React.Fragment key={k++}>{inner}</React.Fragment>;
    });
  return walk(parseCopy(tpl));
}

/** What a missing row renders as: the id, visibly, so nobody mistakes it for prose. */
export const missingCopy = (id: string) => `[${id}]`;
