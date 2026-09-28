/**
 * The copy store — every reader-visible string a product page renders.
 *
 * WHY
 * A product's words are its content, and its content lives in its database,
 * not in git (see scripts/product-db.ts). The pages in git therefore carry
 * content IDs, and the words come from `app/(products)/<slug>/_copy.json` —
 * the working copy `pnpm product:db pull <slug>` writes before a build and
 * `push <slug>` saves back to the `ui_copy` table. The JSON is gitignored.
 *
 * THE ID
 * `<product>.<page>.<tag>-<n>` — `ai-edu.kernel.p-2` is the second paragraph
 * of app/(products)/ai-edu/kernel/page.tsx. The product is the first segment,
 * so one call resolves any id to its file; the page is the route folder with
 * `/` as `.`; the tag is the element that held the words. Ids are assigned by
 * scripts/codemod-copy.ts once and then owned by the page: a new string gets
 * a new id by hand, and `validate-copy` refuses a build whose code names an id
 * the working copy does not carry.
 *
 * READING
 *   <T id="ai-edu.kernel.p-2" v={{ r: 0.71 }} c={[<Link href="…" />]} />
 *     → <span class="cid" data-cid="ai-edu.kernel.p-2">…</span>
 *   t("ai-edu.kernel.placeholder-1")                     → a string
 *
 * The site's own pages and the shared components are the product `site`
 * (ids `site.<page>.<tag>-<n>`, working copy app/_copy.json). Its client
 * components are nested too deep to scope one by one, so the root layout
 * provides the rows for all of them at once (see ./site-scopes.ts, generated
 * by the codemod from the files marked "use client").
 *
 * `T` wraps the words in a span carrying the id, so the id is on the UI — an
 * editor can inspect any sentence and know which row it is. The span is
 * `display: contents`, so it draws no box and leaves flex/grid parents alone.
 *
 * Server only: it reads the file with fs. Client components get their slice
 * through <CopyScope> (below) and `useCopy()` from ./client.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import React, { type ReactNode } from "react";
import { renderCopyNodes, renderCopyString, missingCopy, type CopyVars } from "./render";
import { CopyProvider } from "./client";

export type CopyMap = Record<string, string>;

/**
 * `site` is a product too — the platform's own pages and the shared components
 * under app/_platform. Its folder is app/ itself, so its working copy sits at
 * app/_copy.json; every other product's sits beside its data modules.
 */
export const copyFile = (product: string) =>
  product === "site"
    ? path.join(process.cwd(), "app", "_copy.json")
    : path.join(process.cwd(), "app", "(products)", product, "_copy.json");

type Cached = { rows: CopyMap; mtime: number; checkedAt: number };
const _cache = new Map<string, Cached>();
// Production memoises for the life of the instance: the file is written before
// the build and never changes under a running server. Dev re-checks the mtime
// so an edit to _copy.json shows on the next request.
const RECHECK_MS = process.env.NODE_ENV === "production" ? Infinity : 1000;

function load(product: string): CopyMap {
  const f = copyFile(product);
  const cached = _cache.get(product);
  if (cached && Date.now() - cached.checkedAt < RECHECK_MS) return cached.rows;
  let mtime = 0;
  try {
    mtime = fs.statSync(f).mtimeMs;
  } catch {
    /* no working copy: every id renders as itself */
  }
  if (cached && cached.mtime === mtime) {
    cached.checkedAt = Date.now();
    return cached.rows;
  }
  let rows: CopyMap = {};
  if (mtime) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, "utf8")) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) rows = parsed as CopyMap;
    } catch (err) {
      console.error(`[copy] ${path.relative(process.cwd(), f)} is not valid JSON:`, (err as Error).message);
    }
  }
  _cache.set(product, { rows, mtime, checkedAt: Date.now() });
  return rows;
}

/** `ai-edu.kernel.p-2` → `ai-edu`. */
export const productOf = (id: string) => id.slice(0, id.indexOf(".") === -1 ? id.length : id.indexOf("."));

const _warned = new Set<string>();
function warnMissing(id: string) {
  if (process.env.NODE_ENV === "production" || _warned.has(id)) return;
  _warned.add(id);
  console.warn(`[copy] no row for ${id} — run \`pnpm product:db pull ${productOf(id)}\` or add it to _copy.json`);
}

/** The raw template for an id, or null when the working copy has no row. */
export function copyRow(id: string): string | null {
  const row = load(productOf(id))[id];
  return typeof row === "string" ? row : null;
}

/** All rows whose id starts with one of `prefixes` — what a client subtree needs. */
export function copySlice(prefixes: string | string[]): CopyMap {
  const list = Array.isArray(prefixes) ? prefixes : [prefixes];
  const out: CopyMap = {};
  for (const prefix of list) {
    const all = load(productOf(prefix));
    for (const k of Object.keys(all)) if (k.startsWith(prefix)) out[k] = all[k]!;
  }
  return out;
}

/** The words as a string, for attributes and metadata. */
export function t(id: string, vars?: CopyVars): string {
  const row = copyRow(id);
  if (row == null) {
    warnMissing(id);
    return missingCopy(id);
  }
  return renderCopyString(row, vars);
}

/** The words as nodes, tagged with their id. */
export function T({ id, v, c }: { id: string; v?: CopyVars; c?: ReactNode[] }) {
  const row = copyRow(id);
  if (row == null) warnMissing(id);
  return (
    <span className="cid" data-cid={id}>
      {row == null ? missingCopy(id) : renderCopyNodes(row, v, c)}
    </span>
  );
}

/**
 * Hand a client subtree its copy. Wrap a client component in the server page
 * that renders it, with the id prefix that component's rows share:
 *
 *   <CopyScope prefix="gtm.workspace.confidencebar">
 *     <ConfidenceBar … />
 *   </CopyScope>
 */
export function CopyScope({ prefix, children }: { prefix: string | string[]; children: ReactNode }) {
  return <CopyProvider rows={copySlice(prefix)}>{children}</CopyProvider>;
}
