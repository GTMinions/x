/**
 * Move a product's reader-visible strings out of its .tsx files and into its
 * copy working copy, leaving a content id behind.
 *
 * WHAT IT REWRITES
 *   JSX children with prose      <p>Hi <b>there</b> {n}</p>
 *                            →   <p><T id="…" v={{ n }} c={[<b />]} /></p>
 *                                row: "Hi <0>there</0> {{n}}"
 *   prose attributes             placeholder="Search…"  →  placeholder={t("…")}
 *   prose string literals        label: "Learners"      →  label: t("…")
 *   prose template literals      `${n} left`            →  t("…", { n })
 *
 * WHAT IT LEAVES ALONE (the blacklists below)
 *   class names, hrefs, style values, keys, ids, slugs, anything compared with
 *   === / !== / switch, method arguments that are lookups (includes, split…),
 *   the "use client" directive, console and Error messages, and any string
 *   that also appears in a comparison somewhere in the same file — a value the
 *   code branches on is data, not copy, even when it reads like a sentence.
 *
 * WHAT "PROSE" MEANS
 *   Two or more words, at least one with letters, or a single Capitalised word.
 *   "Avg mastery", "Y3 retained" and "Learners" are prose; "space-between",
 *   "var(--accent)", "10px 0 0" and "ok" are not.
 *
 * IDS
 *   <product>.<page>.<tag>-<n>: the product slug, the route folder with `/`
 *   as `.` (the landing page is `home`; a `_Component.tsx` beside a page is
 *   `<page>.<component>`), the element or attribute or object key that held
 *   the words, and a per-file counter for that tag. Assigned in source order
 *   on the first run; a second run over already-converted files is a no-op
 *   because there is no prose left to find.
 *
 * Client components ("use client") get the same rewrite, import `useCopy`
 * from the client module, and have `const { T, t } = useCopy()` inserted at
 * the top of every component that renders copy — a top-level function or
 * arrow whose name is PascalCase (memo()/forwardRef() unwrapped). Copy that
 * sits outside any such component (a module-level constant, a lowercase
 * helper) is left in place with a warning: a hook cannot go there. The
 * <CopyScope> that feeds the hook is still the server page's job — except for
 * `site`, whose client components are provided for all at once by the root
 * layout from the generated ./site-scopes.ts.
 *
 * `site` is the platform itself: app/ minus app/(products) and app/api. Its
 * ids are `site.<page>.<tag>-<n>` and its working copy is app/_copy.json.
 *
 * Usage: npx tsx scripts/codemod-copy.ts <slug> [--dry] [--only <relpath>]
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

// ── configuration ────────────────────────────────────────────────────────────

/** Attributes whose string value is never copy. */
const ATTR_SKIP = new Set([
  "className", "class", "href", "src", "key", "id", "style", "type", "name", "rel", "target", "role",
  "htmlFor", "value", "defaultValue", "method", "action", "encType", "autoComplete", "dir", "lang",
  "slug", "product", "productSlug", "scope", "active", "variant", "tone", "kind", "status", "color",
  "accent", "size", "icon", "format", "mode", "tab", "as", "sort", "order", "orientation", "shape",
  "fill", "stroke", "viewBox", "d", "xmlns", "width", "height", "min", "max", "step", "pattern",
  "inputMode", "form", "list", "wrap", "loading", "decoding", "sizes", "srcSet", "crossOrigin",
  "referrerPolicy", "download", "hrefLang", "media", "charSet", "content", "httpEquiv", "property",
  "prefetch", "replace", "locale", "align", "valign", "dangerouslySetInnerHTML", "suppressHydrationWarning",
  "aria-hidden", "aria-live", "aria-current", "aria-selected", "aria-expanded", "aria-controls",
  "aria-labelledby", "aria-describedby", "aria-haspopup", "aria-pressed", "aria-checked",
  "data-shell", "data-register", "data-tone", "data-kind", "data-state", "data-cid",
]);

/** Object keys whose string value is never copy. */
const KEY_SKIP = new Set([
  "key", "id", "slug", "href", "url", "src", "to", "path", "route", "className", "class", "color",
  "background", "accent", "fill", "stroke", "kind", "type", "status", "variant", "mode", "tone", "size",
  "icon", "rel", "target", "role", "dir", "lang", "locale", "code", "sku", "tab", "format",
  "unit", "date", "time", "at", "when", "on", "method", "event", "param", "field", "prop", "scope",
  "product", "productSlug", "entity", "entitySlug", "author", "handle", "domain", "email", "phone",
  "verdict", "level", "tier", "stage", "state", "severity", "priority", "category", "group", "bucket",
  "lens", "axis", "dimension", "metric", "measure", "kpi", "rel_path", "relPath", "file", "dirname",
  "fontFamily", "font", "gridTemplateColumns", "gridTemplateRows", "gridArea", "gridColumn", "gridRow",
  "border", "borderLeft", "borderRight", "borderTop", "borderBottom", "borderRadius", "borderColor",
  "boxShadow", "textShadow", "transition", "transform", "animation", "outline", "padding", "margin",
  "inset", "flex", "flexFlow", "placeItems", "placeContent", "objectFit", "backgroundImage",
  "backgroundSize", "backgroundPosition", "listStyle", "textDecoration", "whiteSpace", "wordBreak",
  "overflowWrap", "letterSpacing", "textTransform", "fontVariant", "fontFeatureSettings", "cursor",
  "pointerEvents", "userSelect", "position", "display", "alignItems", "justifyContent", "alignSelf",
  "justifySelf", "flexDirection", "flexWrap", "overflow", "overflowX", "overflowY", "textAlign",
  "verticalAlign", "textOverflow", "quotes", "filter", "backdropFilter", "clipPath",
  "maskImage", "willChange", "mixBlendMode", "isolation", "aspectRatio", "columns", "columnGap",
  "rowGap", "gap", "zIndex", "top", "left", "right", "bottom", "width", "height", "minWidth", "maxWidth",
  "minHeight", "maxHeight", "lineHeight", "fontSize", "fontWeight", "fontStyle", "opacity", "visibility",
  "resize", "appearance", "scrollBehavior", "scrollSnapType", "touchAction", "accentColor", "caretColor",
  "colorScheme", "columnRule", "counterReset", "counterIncrement", "emptyCells", "float", "clear",
  "tableLayout", "borderCollapse", "borderSpacing", "captionSide", "hyphens", "tabSize", "textIndent",
  "textJustify", "unicodeBidi", "writingMode", "wordSpacing", "orphans", "widows", "pageBreakAfter",
  "boxSizing", "contain", "overscrollBehavior", "scrollMargin", "scrollPadding", "objectPosition",
  "imageRendering", "shapeOutside", "shapeMargin", "textRendering", "fontKerning", "fontStretch",
  "textUnderlineOffset", "textDecorationThickness", "textDecorationColor", "textDecorationStyle",
]);

/** Variable names whose string initialiser is never copy. */
const VAR_SKIP_RE = /(class|cls|style|color|colour|bg|href|url|src|path|route|slug|key|id|kind|type|status|mode|variant|tone|font|icon|pill|tag|regex|re|pattern|sel|selector|attr|prop|field|name)$/i;

/** Callee names whose string arguments are lookups, formats or messages — not copy. */
const CALL_SKIP = new Set([
  "includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "replace", "replaceAll", "split",
  "match", "matchAll", "test", "exec", "localeCompare", "get", "has", "set", "delete", "querySelector",
  "querySelectorAll", "getElementById", "getItem", "setItem", "removeItem", "log", "warn", "error",
  "info", "debug", "trace", "assert", "require", "import", "join", "padStart", "padEnd", "repeat",
  "charAt", "at", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "Intl", "DateTimeFormat",
  "NumberFormat", "RegExp", "Error", "TypeError", "RangeError", "Set", "Map", "Date", "URL",
  "URLSearchParams", "encodeURIComponent", "decodeURIComponent", "fetch", "redirect", "notFound",
  "revalidatePath", "revalidateTag", "cookies", "headers", "useState", "useRef", "createContext",
  "Symbol", "parseInt", "parseFloat", "Number", "String", "Boolean", "Array", "Object", "JSON",
  "readFileSync", "readdirSync", "existsSync", "statSync", "writeFileSync", "resolve", "join",
  "relative", "dirname", "basename", "extname", "execute", "batch", "prepare", "run", "all",
  "sort", "find", "findIndex", "filter", "some", "every", "reduce", "flatMap", "forEach", "concat",
  "keys", "values", "entries", "fromEntries", "assign", "freeze", "toFixed", "toPrecision",
  "setAttribute", "getAttribute", "classList", "add", "remove", "toggle", "contains", "push", "unshift",
  "splice", "slice", "substring", "substr", "trim", "trimStart", "trimEnd", "normalize", "search",
  "cid", "copySlice", "copyRow", "CopyScope", "useCopy", "t", "T",
]);

/** Method names that add nothing to a variable's name. */
const NAME_NOISE = new Set([
  "toFixed", "toLocaleString", "toString", "toUpperCase", "toLowerCase", "length", "join", "map",
  "filter", "slice", "trim", "size", "round", "floor", "ceil", "padStart", "padEnd", "replace", "split",
  "at", "toLocaleDateString", "toLocaleTimeString", "toISOString", "trimEnd", "trimStart", "sort",
  "reverse", "flat", "reduce", "find", "values", "keys", "entries", "from", "of", "abs", "max", "min",
]);

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
  hellip: "…", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", copy: "©",
  reg: "®", trade: "™", times: "×", middot: "·", bull: "•", rarr: "→", larr: "←", uarr: "↑", darr: "↓",
  deg: "°", plusmn: "±", le: "≤", ge: "≥", ne: "≠", approx: "≈", infin: "∞", micro: "µ", para: "¶",
  sect: "§", dagger: "†", Dagger: "‡", euro: "€", pound: "£", yen: "¥", cent: "¢", thinsp: " ",
  ensp: " ", emsp: " ", zwj: "‍", zwnj: "‌", shy: "­",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z]+);/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[body] ?? m;
  });
}

/** Babel's JSX text rule: trim line ends, drop blank lines, join with one space. */
function cleanJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i]!.match(/[^ \t]/)) lastNonEmpty = i;
  let out = "";
  for (let i = 0; i < lines.length; i++) {
    const isFirst = i === 0;
    const isLast = i === lines.length - 1;
    const isLastNonEmpty = i === lastNonEmpty;
    let line = lines[i]!.replace(/\t/g, " ");
    if (!isFirst) line = line.replace(/^[ ]+/, "");
    if (!isLast) line = line.replace(/[ ]+$/, "");
    if (line) {
      if (!isLastNonEmpty) line += " ";
      out += line;
    }
  }
  return decodeEntities(out);
}

/**
 * `loose` is the rule for words that sit in JSX children: there, any word is
 * copy ("overridden", "reviewed", "ms"). Elsewhere a lone lowercase word is
 * far more often a class, a key or a mode than a label, so the strict rule
 * wants two words or a Capital.
 */
export function isProse(s: string, loose = false): boolean {
  const text = s.trim();
  if (!text) return false;
  if (loose) return /[A-Za-zÀ-ɏЀ-ӿ぀-ヿ一-鿿]{2,}/.test(text) && !/^&[a-z]+;$/.test(text);
  if (/^(https?:|mailto:|tel:|\/|#|\.\/|\.\.\/|var\(|rgb|hsl|url\(|calc\()/i.test(text)) return false;
  if (/^[\w-]+\.(tsx?|jsx?|json|md|css|svg|png|jpe?g|webp|gif|ico)$/.test(text)) return false;
  // Markup being built as a string is code, not copy.
  if (/<\/?[a-z][a-z0-9-]*>/i.test(text)) return false;
  if (/[぀-ヿ一-鿿]{2,}/.test(text)) return true;
  const words = text.split(/\s+/);
  const letterWords = words.filter((w) => /[A-Za-zÀ-ɏЀ-ӿ぀-ヿ一-鿿]{2,}/.test(w));
  if (!letterWords.length) return false;
  // Two or more words, or one Capitalised word: "Y3 retained", "→ Model",
  // "decidable · certain", "Learners". Position blacklists keep "pill ok" out.
  if (words.length >= 2) return true;
  return /^[A-Z][a-z]+[.!?…:]*$/.test(text);
}

// ── per-file state ───────────────────────────────────────────────────────────

type Edit = { start: number; end: number; text: string };
type Row = { id: string; value: string };

class FileMod {
  readonly src: string;
  readonly sf: ts.SourceFile;
  readonly rows: Row[] = [];
  readonly warnings: string[] = [];
  usedT = false;
  usedt = false;
  private counters = new Map<string, number>();
  private compared = new Set<string>();
  readonly tName: string;
  readonly isClient: boolean;
  /** Client files only: the top-level components a hook may be inserted into. */
  private components: Component[] = [];

  constructor(readonly file: string, readonly product: string, readonly page: string, private readonly taken: Set<string>) {
    this.src = fs.readFileSync(file, "utf8");
    // Ids this file already names stay taken, so a re-run never hands one out twice.
    for (const m of this.src.matchAll(new RegExp(`["'\`](${product.replace(/[-]/g, "\\-")}\\.[a-z0-9_.-]+-\\d+)["'\`]`, "g"))) taken.add(m[1]!);
    this.sf = ts.createSourceFile(file, this.src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    this.isClient = /^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(this.src);
    if (this.isClient) this.components = findComponents(this.sf);
    // Every string the file compares against is data, not copy.
    const declared = new Set<string>();
    const visit = (n: ts.Node) => {
      if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) {
        for (const side of [n.left, n.right]) if (ts.isStringLiteral(side) || ts.isNoSubstitutionTemplateLiteral(side)) this.compared.add(side.text);
      }
      if (ts.isCaseClause(n) && (ts.isStringLiteral(n.expression) || ts.isNoSubstitutionTemplateLiteral(n.expression))) this.compared.add(n.expression.text);
      if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isBindingElement(n)) && ts.isIdentifier(n.name)) declared.add(n.name.text);
      if (ts.isFunctionDeclaration(n) && n.name) declared.add(n.name.text);
      // An import of `t` from the copy module is ours, not a collision.
      if (ts.isImportSpecifier(n)) {
        const decl = n.parent.parent.parent;
        const from = ts.isImportDeclaration(decl) && ts.isStringLiteral(decl.moduleSpecifier) ? decl.moduleSpecifier.text : "";
        if (!from.startsWith("@/app/_platform/copy")) declared.add(n.name.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(this.sf);
    this.tName = declared.has("t") ? "copyText" : "t";
  }

  nextId(tag: string): string {
    const key = tag.toLowerCase().replace(/[^a-z0-9]+/g, "") || "s";
    let n = this.counters.get(key) ?? 0;
    let id: string;
    do {
      n++;
      id = `${this.product}.${this.page}.${key}-${n}`;
    } while (this.taken.has(id));
    this.counters.set(key, n);
    this.taken.add(id);
    return id;
  }

  addRow(id: string, value: string) {
    this.rows.push({ id, value });
  }

  /** Words that would read as a slot once in a row: flag them, they need escaping by hand. */
  checkLiteral(text: string) {
    if (/\{\{|<\d+\s*\/?>|<\/\d+>/.test(text)) this.warnings.push(`source text contains slot syntax literally: ${JSON.stringify(text.slice(0, 60))}`);
  }

  tCall(id: string, vars?: string[], at?: ts.Node): string {
    this.usedt = true;
    if (at) this.markUse(at, "t");
    return vars && vars.length ? `${this.tName}(${JSON.stringify(id)}, { ${vars.join(", ")} })` : `${this.tName}(${JSON.stringify(id)})`;
  }

  // ── generic rewrite over a range ─────────────────────────────────────────

  /** The whole file, rewritten. (getStart would skip the leading comment.) */
  rewriteAll(): string {
    const edits: Edit[] = [];
    this.collect(this.sf, edits, true);
    edits.push(...this.hookEdits());
    return this.splice(0, this.src.length, edits);
  }

  /** The component (if any) a node sits inside — client files only. */
  private componentAt(node: ts.Node): Component | null {
    const pos = node.getStart(this.sf);
    return this.components.find((c) => pos >= c.start && pos < c.end) ?? null;
  }

  private markUse(node: ts.Node, kind: "T" | "t") {
    if (!this.isClient) return;
    const c = this.componentAt(node);
    if (c) c.uses.add(kind);
  }

  /** In a client file, copy can only live where a hook can: inside a component. */
  private hookable(node: ts.Node, what: string): boolean {
    if (!this.isClient) return true;
    // A parameter default is evaluated before the body runs, so before the hook.
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if (ts.isParameter(n)) { this.warnings.push(`client copy in a parameter default left in place: ${JSON.stringify(what.slice(0, 50))}`); return false; }
      if (ts.isFunctionLike(n)) break;
    }
    if (this.componentAt(node)) return true;
    this.warnings.push(`client copy outside any component left in place: ${JSON.stringify(what.slice(0, 50))}`);
    return false;
  }

  /** `const { T, t } = useCopy();` at the top of every component that renders copy. */
  private hookEdits(): Edit[] {
    const out: Edit[] = [];
    for (const c of this.components) {
      if (!c.uses.size) continue;
      const names: string[] = [];
      if (c.uses.has("T")) names.push("T");
      if (c.uses.has("t")) names.push(this.tName === "t" ? "t" : `t: ${this.tName}`);
      const hook = `const { ${names.join(", ")} } = useCopy();`;
      if (c.body.kind === "block") {
        const indent = " ".repeat(indentOf(this.src, c.body.firstStatement) || 2);
        out.push({ start: c.body.open, end: c.body.open, text: `\n${indent}${hook}` });
      } else {
        // Expression body: wrap it in a block so the hook has somewhere to go.
        out.push({ start: c.body.start, end: c.body.start, text: `{\n  ${hook}\n  return (` });
        out.push({ start: c.body.end, end: c.body.end, text: `);\n}` });
      }
    }
    return out;
  }

  /** Text of `node` with every rewrite inside it applied. */
  rewriteNode(node: ts.Node): string {
    const edits: Edit[] = [];
    this.collect(node, edits, true);
    return this.splice(node.getStart(this.sf), node.getEnd(), edits);
  }

  private splice(start: number, end: number, edits: Edit[]): string {
    edits.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
    let out = "";
    let at = start;
    for (const e of edits) {
      if (e.start < at) continue; // nested inside an earlier edit — already handled
      out += this.src.slice(at, e.start) + e.text;
      at = e.end;
    }
    return out + this.src.slice(at, end);
  }

  /** Find rewrite targets under `node` (not descending into ones that rewrite themselves). */
  private collect(node: ts.Node, edits: Edit[], isRoot = false) {
    void isRoot;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      edits.push({ start: node.getStart(this.sf), end: node.getEnd(), text: this.rewriteJsx(node) });
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const r = this.rewriteStringLiteral(node);
      if (r) edits.push(r);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      const r = this.rewriteTemplate(node);
      if (r) {
        edits.push(r);
        return;
      }
    }
    ts.forEachChild(node, (c) => this.collect(c, edits));
  }

  // ── strings ──────────────────────────────────────────────────────────────

  private stringContext(node: ts.Node): { ok: boolean; tag: string; attr?: boolean } {
    const p = node.parent;
    if (!p) return { ok: false, tag: "s" };
    if (ts.isExpressionStatement(p)) return { ok: false, tag: "s" }; // "use client"
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isExternalModuleReference(p) || ts.isImportTypeNode(p)) return { ok: false, tag: "s" };
    if (ts.isLiteralTypeNode(p) || ts.isTypeNode(p)) return { ok: false, tag: "s" };
    if (ts.isPropertyAssignment(p) && p.name === node) return { ok: false, tag: "s" };
    if (ts.isComputedPropertyName(p) || ts.isElementAccessExpression(p)) return { ok: false, tag: "s" };
    if (ts.isCaseClause(p)) return { ok: false, tag: "s" };
    if (ts.isBinaryExpression(p)) {
      const k = p.operatorToken.kind;
      if (k === ts.SyntaxKind.EqualsEqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsEqualsToken || k === ts.SyntaxKind.EqualsEqualsToken || k === ts.SyntaxKind.ExclamationEqualsToken || k === ts.SyntaxKind.InKeyword) return { ok: false, tag: "s" };
    }
    if (ts.isJsxExpression(p) && p.parent && ts.isJsxAttribute(p.parent)) {
      const name = p.parent.name.getText(this.sf);
      if (ATTR_SKIP.has(name) || name.startsWith("data-") || name.startsWith("on")) return { ok: false, tag: "s" };
      const owner = p.parent.parent.parent;
      const tagName = ts.isJsxSelfClosingElement(owner) || ts.isJsxOpeningElement(owner) ? owner.tagName.getText(this.sf) : "";
      if (tagName === "T" || tagName === "CopyScope") return { ok: false, tag: "s" };
      return { ok: true, tag: name.replace(/^aria-/, "") };
    }
    if (ts.isJsxAttribute(p)) {
      const name = p.name.getText(this.sf);
      if (ATTR_SKIP.has(name) || name.startsWith("data-") || name.startsWith("on")) return { ok: false, tag: "s" };
      const owner = p.parent.parent;
      const tagName = ts.isJsxSelfClosingElement(owner) || ts.isJsxOpeningElement(owner) ? owner.tagName.getText(this.sf) : "";
      if (tagName === "T" || tagName === "CopyScope") return { ok: false, tag: "s" };
      return { ok: true, tag: name.replace(/^aria-/, ""), attr: true };
    }
    if (ts.isPropertyAssignment(p)) {
      const key = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : p.name.getText(this.sf);
      if (KEY_SKIP.has(key)) return { ok: false, tag: "s" };
      if (this.insideStyle(p)) return { ok: false, tag: "s" };
      return { ok: true, tag: key };
    }
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
      if (VAR_SKIP_RE.test(p.name.text)) return { ok: false, tag: "s" };
      return { ok: true, tag: p.name.text };
    }
    // Call arguments: only when the callee is not a lookup/format/message.
    const call = this.enclosingCall(node);
    if (call) {
      const callee = call.expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
      if (!name || CALL_SKIP.has(name) || ts.isNewExpression(call)) return { ok: false, tag: "s" };
    }
    if (this.insideStyle(node)) return { ok: false, tag: "s" };
    // Inside JSX children / conditionals / arrays / arrow bodies: copy.
    const tag = this.nearestTag(node);
    return { ok: true, tag };
  }

  private enclosingCall(node: ts.Node): ts.CallExpression | ts.NewExpression | null {
    let n: ts.Node = node;
    while (n.parent) {
      const p: ts.Node = n.parent;
      if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.some((a) => a === n)) return p;
      if (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isBinaryExpression(p) || ts.isArrayLiteralExpression(p) || ts.isTemplateSpan(p) || ts.isTemplateExpression(p) || ts.isAsExpression(p) || ts.isSatisfiesExpression(p)) {
        n = p;
        continue;
      }
      return null;
    }
    return null;
  }

  private insideStyle(node: ts.Node): boolean {
    let n: ts.Node | undefined = node;
    while (n) {
      if (ts.isJsxAttribute(n)) return n.name.getText(this.sf) === "style";
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return /style/i.test(n.name.text);
      if (ts.isPropertyAssignment(n)) {
        const key = ts.isIdentifier(n.name) ? n.name.text : "";
        if (key === "style" || /Style$/.test(key)) return true;
      }
      if (ts.isFunctionLike(n) || ts.isSourceFile(n)) return false;
      n = n.parent;
    }
    return false;
  }

  private nearestTag(node: ts.Node): string {
    let n: ts.Node | undefined = node;
    while (n) {
      if (ts.isJsxElement(n)) return n.openingElement.tagName.getText(this.sf);
      if (ts.isJsxSelfClosingElement(n)) return n.tagName.getText(this.sf);
      if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) return n.name.text;
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) return n.name.text;
      if (ts.isFunctionLike(n) || ts.isSourceFile(n)) break;
      n = n.parent;
    }
    return "s";
  }

  private rewriteStringLiteral(node: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral): Edit | null {
    const value = node.text;
    if (!isProse(value, this.rendersAsChild(node))) return null;
    this.checkLiteral(value);
    if (this.compared.has(value)) {
      this.warnings.push(`kept (compared elsewhere): ${JSON.stringify(value.slice(0, 50))}`);
      return null;
    }
    const ctx = this.stringContext(node);
    if (!ctx.ok) return null;
    if (!this.hookable(node, value)) return null;
    const id = this.nextId(ctx.tag);
    this.addRow(id, value);
    const call = this.tCall(id, undefined, node);
    return { start: node.getStart(this.sf), end: node.getEnd(), text: ctx.attr ? `{${call}}` : call };
  }

  private rewriteTemplate(node: ts.TemplateExpression): Edit | null {
    // Prose test on the literal parts only: `${a} · ${b}` is not copy.
    const literal = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ");
    if (!isProse(literal, this.rendersAsChild(node))) return null;
    const ctx = this.stringContext(node);
    if (!ctx.ok) return null;
    if (!this.hookable(node, literal)) return null;
    const vars = new VarNames();
    let tpl = node.head.text;
    const args: string[] = [];
    for (const span of node.templateSpans) {
      const name = vars.name(this.varName(span.expression), span.expression);
      pushArg(args, name, this.rewriteNode(span.expression));
      tpl += `{{${name}}}` + span.literal.text;
    }
    const id = this.nextId(ctx.tag);
    this.addRow(id, tpl);
    const call = this.tCall(id, args, node);
    return { start: node.getStart(this.sf), end: node.getEnd(), text: ctx.attr ? `{${call}}` : call };
  }

  /** Is this literal's value what a JSX child renders (directly or through ?: / ?? / ||)? */
  private rendersAsChild(node: ts.Node): boolean {
    let n: ts.Node = node;
    while (n.parent) {
      const p: ts.Node = n.parent;
      if (ts.isJsxExpression(p)) return !!p.parent && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent));
      if (ts.isConditionalExpression(p) && (p.whenTrue === n || p.whenFalse === n)) { n = p; continue; }
      if (ts.isParenthesizedExpression(p)) { n = p; continue; }
      if (ts.isBinaryExpression(p) && (p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || p.operatorToken.kind === ts.SyntaxKind.BarBarToken)) { n = p; continue; }
      return false;
    }
    return false;
  }

  // ── JSX ──────────────────────────────────────────────────────────────────

  private rewriteJsx(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment): string {
    if (ts.isJsxSelfClosingElement(node)) return this.rewriteOpening(node);
    const children = node.children;
    const open = ts.isJsxElement(node) ? this.rewriteOpening(node.openingElement) : "<>";
    const close = ts.isJsxElement(node) ? node.closingElement.getText(this.sf) : "</>";
    const tagName = ts.isJsxElement(node) ? node.openingElement.tagName.getText(this.sf) : "fragment";
    if (this.hasProse(children) && tagName !== "T" && tagName !== "CopyScope" && this.hookable(node, this.src.slice(children[0]!.pos, children[children.length - 1]!.end).trim())) {
      this.markUse(node, "T");
      const body = this.buildT(children, tagName);
      // A multi-line element keeps its shape: the T sits on its own line where
      // the words began, the closing tag on its own line where it was.
      const firstText = this.src.slice(children[0]!.pos, children[0]!.end);
      const multiline = /^[ \t]*\n/.test(firstText);
      if (!multiline) return open + body + close;
      const innerIndent = indentOf(this.src, children[0]!.pos + (firstText.match(/^[ \t]*\n/)?.[0].length ?? 0));
      const outerIndent = indentOf(this.src, node.getStart(this.sf));
      return open + "\n" + " ".repeat(innerIndent) + body + "\n" + " ".repeat(outerIndent) + close;
    }
    // No prose here: rewrite attributes and descend into children.
    const edits: Edit[] = [];
    for (const c of children) {
      if (ts.isJsxText(c)) continue;
      if (ts.isJsxExpression(c)) {
        if (c.expression) this.collect(c.expression, edits, true);
        continue;
      }
      edits.push({ start: c.getStart(this.sf), end: c.getEnd(), text: this.rewriteJsx(c) });
    }
    const first = children.length ? children[0]!.pos : node.getEnd();
    const last = children.length ? children[children.length - 1]!.end : node.getEnd();
    const inner = this.splice(first, last, edits);
    return open + inner + close;
  }

  private rewriteOpening(el: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
    const edits: Edit[] = [];
    for (const a of el.attributes.properties) {
      if (ts.isJsxAttribute(a) && a.initializer) {
        if (ts.isStringLiteral(a.initializer)) {
          const r = this.rewriteStringLiteral(a.initializer);
          if (r) edits.push(r);
        } else if (ts.isJsxExpression(a.initializer) && a.initializer.expression) {
          const name = a.name.getText(this.sf);
          if (ATTR_SKIP.has(name) || name.startsWith("data-") || name.startsWith("on")) {
            // still descend: an onClick may render JSX, a style may not hold copy.
            if (name === "style" || name === "className" || name === "href" || name === "key") continue;
            this.collect(a.initializer.expression, edits, true);
          } else {
            this.collect(a.initializer.expression, edits, true);
          }
        }
      } else if (ts.isJsxSpreadAttribute(a)) {
        this.collect(a.expression, edits, true);
      }
    }
    return this.splice(el.getStart(this.sf), el.getEnd(), edits);
  }

  private hasProse(children: ts.NodeArray<ts.JsxChild>): boolean {
    for (const c of children) {
      if (ts.isJsxText(c) && isProse(cleanJsxText(c.text), true)) return true;
      if (ts.isJsxExpression(c) && c.expression && (ts.isStringLiteral(c.expression) || ts.isNoSubstitutionTemplateLiteral(c.expression)) && isProse(c.expression.text, true)) return true;
      if (ts.isJsxExpression(c) && c.expression && ts.isTemplateExpression(c.expression)) {
        const lit = [c.expression.head.text, ...c.expression.templateSpans.map((s) => s.literal.text)].join(" ");
        if (isProse(lit, true)) return true;
      }
    }
    // Text split only by inline elements — "Read <b>this</b>" — is prose even
    // when no single text node is; join the plain text and test again.
    const joined = children.map((c) => (ts.isJsxText(c) ? cleanJsxText(c.text) : "")).join("");
    return isProse(joined, true);
  }

  /** Children with prose → a single <T …/> plus its row. */
  private buildT(children: ts.NodeArray<ts.JsxChild>, tagName: string): string {
    const vars = new VarNames();
    const varArgs: string[] = [];
    const els: string[] = [];
    const tpl = this.template(children, vars, varArgs, els);
    const id = this.nextId(tagName);
    this.addRow(id, tpl.trim());
    this.usedT = true;
    const parts = [`id=${JSON.stringify(id)}`];
    if (varArgs.length) parts.push(`v={{ ${varArgs.join(", ")} }}`);
    if (els.length) parts.push(`c={[${els.join(", ")}]}`);
    return `<T ${parts.join(" ")} />`;
  }

  private template(children: ts.NodeArray<ts.JsxChild>, vars: VarNames, varArgs: string[], els: string[]): string {
    let tpl = "";
    for (const c of children) {
      if (ts.isJsxText(c)) {
        this.checkLiteral(c.text);
        tpl += cleanJsxText(c.text);
      } else if (ts.isJsxExpression(c)) {
        const e = c.expression;
        if (!e) continue; // {/* comment */}
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) {
          this.checkLiteral(e.text);
          tpl += e.text;
        } else if (ts.isTemplateExpression(e)) {
          tpl += e.head.text;
          for (const span of e.templateSpans) {
            const name = vars.name(this.varName(span.expression), span.expression);
            const text = this.rewriteNode(span.expression);
            pushArg(varArgs, name, text);
            tpl += `{{${name}}}` + span.literal.text;
          }
        } else {
          const name = vars.name(this.varName(e), e);
          const text = this.rewriteNode(e);
          pushArg(varArgs, name, text);
          tpl += `{{${name}}}`;
        }
      } else if (ts.isJsxSelfClosingElement(c)) {
        const n = els.length;
        els.push(this.rewriteOpening(c));
        tpl += `<${n}/>`;
      } else if (ts.isJsxElement(c)) {
        const n = els.length;
        const open = this.rewriteOpening(c.openingElement);
        els.push(open.replace(/\s*>$/, " />").replace(/^<(\S+)\s*\/>$/, "<$1 />"));
        const inner = this.template(c.children, vars, varArgs, els);
        tpl += inner.trim() ? `<${n}>${inner}</${n}>` : `<${n}/>`;
      } else if (ts.isJsxFragment(c)) {
        const n = els.length;
        els.push("<></>");
        const inner = this.template(c.children, vars, varArgs, els);
        tpl += `<${n}>${inner}</${n}>`;
      }
    }
    return tpl;
  }

  /** A readable name for an interpolated expression. */
  varName(e: ts.Expression): string {
    const strip = (n: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n) ? strip(n.expression) : n);
    const n = strip(e);
    if (ts.isIdentifier(n)) return n.text;
    if (ts.isPropertyAccessExpression(n)) return NAME_NOISE.has(n.name.text) ? this.varName(n.expression) : n.name.text;
    if (ts.isElementAccessExpression(n)) return this.varName(n.expression);
    if (ts.isCallExpression(n)) {
      const callee = strip(n.expression);
      if (ts.isPropertyAccessExpression(callee)) {
        if (ts.isIdentifier(callee.expression) && (callee.expression.text === "Math" || callee.expression.text === "String" || callee.expression.text === "Number" || callee.expression.text === "Array" || callee.expression.text === "Object")) {
          return n.arguments[0] ? this.varName(n.arguments[0]) : callee.name.text;
        }
        return NAME_NOISE.has(callee.name.text) ? this.varName(callee.expression) : callee.name.text;
      }
      if (ts.isIdentifier(callee)) {
        if (/^(String|Number|Boolean|Math|Array)$/.test(callee.text) && n.arguments[0]) return this.varName(n.arguments[0]);
        return callee.text;
      }
      return "v";
    }
    if (ts.isConditionalExpression(n)) return this.varName(n.whenTrue);
    if (ts.isBinaryExpression(n)) {
      const k = n.operatorToken.kind;
      if (k === ts.SyntaxKind.AmpersandAmpersandToken || k === ts.SyntaxKind.QuestionQuestionToken || k === ts.SyntaxKind.BarBarToken) return this.varName(k === ts.SyntaxKind.AmpersandAmpersandToken ? n.left : n.left);
      return this.varName(n.left);
    }
    if (ts.isTemplateExpression(n)) return n.templateSpans[0] ? this.varName(n.templateSpans[0].expression) : "v";
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) return "node";
    if (ts.isNumericLiteral(n)) return "n";
    return "v";
  }
}

/** One entry per name: the same expression interpolated twice is one variable. */
function pushArg(args: string[], name: string, text: string) {
  if (args.some((a) => a === name || a.startsWith(`${name}: `))) return;
  args.push(name === text ? name : `${name}: ${text}`);
}

class VarNames {
  private used = new Map<string, string>(); // name → expression text
  name(base: string, expr: ts.Expression): string {
    let n = base.replace(/[^A-Za-z0-9_$]/g, "") || "v";
    if (/^\d/.test(n)) n = "v" + n;
    if (/^(T|t|copyText)$/.test(n)) n = n + "Value";
    const text = expr.getText();
    let cand = n;
    let i = 2;
    while (this.used.has(cand) && this.used.get(cand) !== text) cand = `${n}${i++}`;
    this.used.set(cand, text);
    return cand;
  }
}

function indentOf(src: string, pos: number): number {
  const lineStart = src.lastIndexOf("\n", pos - 1) + 1;
  return src.slice(lineStart).match(/^[ \t]*/)?.[0].length ?? 0;
}

// ── import insertion ─────────────────────────────────────────────────────────

function addImport(mod: FileMod, out: string): string {
  if (!mod.usedT && !mod.usedt) return out;
  const names: string[] = [];
  if (mod.isClient) {
    names.push("useCopy");
  } else {
    if (mod.usedT) names.push("T");
    if (mod.usedt) names.push(mod.tName === "t" ? "t" : "t as copyText");
  }
  const from = mod.isClient ? "@/app/_platform/copy/client" : "@/app/_platform/copy";
  const line = `import { ${names.join(", ")} } from "${from}";`;
  const sf = ts.createSourceFile(mod.file, out, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let lastImportEnd = -1;
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    lastImportEnd = s.getEnd();
    // A re-run over a converted file: extend the import it already has.
    if (ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === from && s.importClause?.namedBindings && ts.isNamedImports(s.importClause.namedBindings)) {
      const have = s.importClause.namedBindings.elements.map((e) => e.getText(sf));
      const merged = [...new Set([...have, ...names])];
      const nb = s.importClause.namedBindings;
      return out.slice(0, nb.getStart(sf)) + `{ ${merged.join(", ")} }` + out.slice(nb.getEnd());
    }
  }
  if (lastImportEnd >= 0) return out.slice(0, lastImportEnd) + "\n" + line + out.slice(lastImportEnd);
  // No imports: after the directive / leading comment.
  const first = sf.statements[0];
  const at = first ? first.getStart(sf) : 0;
  const isDirective = first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression);
  if (isDirective) {
    const end = first.getEnd();
    return out.slice(0, end) + "\n\n" + line + out.slice(end);
  }
  return out.slice(0, at) + line + "\n\n" + out.slice(at);
}

// ── driver ───────────────────────────────────────────────────────────────────

function pageIdFor(productDir: string, file: string): string {
  const rel = path.relative(productDir, file).replace(/\\/g, "/");
  const parts = rel.replace(/\.tsx$/, "").split("/");
  const base = parts.pop()!;
  const dir = parts.map((p) => p.replace(/[\[\]()]/g, "").replace(/[^a-z0-9]+/gi, "").toLowerCase()).filter(Boolean);
  if (base === "page" || base === "layout") return dir.length ? dir.join(".") + (base === "layout" ? ".layout" : "") : "home" + (base === "layout" ? ".layout" : "");
  const comp = base.replace(/^_+/, "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
  return [...dir, comp].join(".") || comp;
}

/** Folders under app/ that are not the site's UI: the products, the API, and the copy engine itself. */
const SITE_SKIP = new Set(["(products)", "api", "copy"]);

function walk(dir: string, out: string[], site = false) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    // The generic product routes under (products)/[slug] are the site's pages too.
    if (site && e.isDirectory() && e.name === "(products)") { const g = path.join(full, "[slug]"); if (fs.existsSync(g)) walk(g, out, site); continue; }
    if (site && e.isDirectory() && SITE_SKIP.has(e.name)) continue;
    if (e.isDirectory()) walk(full, out, site);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".stub.tsx")) out.push(full);
  }
}

function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--"));
  const dry = args.includes("--dry");
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  if (!slug) {
    console.error("usage: npx tsx scripts/codemod-copy.ts <slug> [--dry] [--only <relpath>]");
    process.exit(1);
  }
  const site = slug === "site";
  const productDir = site ? path.join(ROOT, "app") : path.join(ROOT, "app", "(products)", slug);
  const files: string[] = [];
  walk(productDir, files, site);
  files.sort();

  const copyPath = path.join(productDir, "_copy.json");
  const existing: Record<string, string> = fs.existsSync(copyPath) ? JSON.parse(fs.readFileSync(copyPath, "utf8")) : {};
  const rows: Record<string, string> = { ...existing };
  let changed = 0;
  let total = 0;
  const clientFiles: string[] = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    if (only && !rel.endsWith(only)) continue;
    const mod = new FileMod(file, slug, pageIdFor(productDir, file), new Set(Object.keys(rows)));
    let out: string;
    try {
      out = mod.rewriteAll();
    } catch (err) {
      console.error(`  ✗ ${rel}: ${(err as Error).message}`);
      continue;
    }
    if (!mod.rows.length) continue;
    out = addImport(mod, out);
    for (const r of mod.rows) {
      if (rows[r.id] !== undefined && rows[r.id] !== r.value) console.warn(`  ! ${r.id} already exists with a different value; keeping the new one`);
      rows[r.id] = r.value;
    }
    total += mod.rows.length;
    changed++;
    if (mod.isClient) clientFiles.push(rel);
    for (const w of mod.warnings) console.warn(`  ! ${rel}: ${w}`);
    console.log(`  ${rel}: ${mod.rows.length} rows${mod.isClient ? "  (client — useCopy() inserted)" : ""}`);
    if (!dry) fs.writeFileSync(file, out);
  }

  if (!dry) {
    const sorted: Record<string, string> = {};
    for (const k of Object.keys(rows).sort()) sorted[k] = rows[k]!;
    fs.writeFileSync(copyPath, JSON.stringify(sorted, null, 2) + "\n");
    if (site) writeSiteScopes(files);
  }
  console.log(`\n${dry ? "would rewrite" : "rewrote"} ${changed} file(s), ${total} rows → ${path.relative(ROOT, copyPath)}`);
  if (clientFiles.length && !site) console.log(`client components (wrap each in <CopyScope prefix> where the server page renders it):\n  ${clientFiles.join("\n  ")}`);
}

/**
 * The id prefixes the site's client components read. The root layout hands
 * these rows to every page, so a client component anywhere in the tree finds
 * its copy without a scope of its own. Derived from the files, so a re-run
 * after a new client component keeps the list right.
 */
function writeSiteScopes(files: string[]) {
  const prefixes = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    if (!/^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use client["']/.test(src)) continue;
    for (const m of src.matchAll(/["'`](site(?:\.[a-z0-9_-]+)+)\.[a-z0-9]+-\d+["'`]/g)) prefixes.add(m[1]! + ".");
  }
  const list = [...prefixes].sort();
  const out = `/**
 * GENERATED by scripts/codemod-copy.ts site — do not edit.
 *
 * The id prefixes of every client component in the site scope. The root
 * layout provides these rows through <CopyScope>, so the platform's client
 * components (nested many levels deep, rendered on every product page) read
 * their copy without a scope each. Re-run the codemod after adding one.
 */
export const SITE_CLIENT_COPY_PREFIXES: string[] = ${JSON.stringify(list, null, 2)};
`;
  fs.writeFileSync(path.join(ROOT, "app", "_platform", "copy", "site-scopes.ts"), out);
  console.log(`  wrote app/_platform/copy/site-scopes.ts (${list.length} prefixes)`);
}

// ── components (client files) ────────────────────────────────────────────────

type Component = {
  name: string;
  start: number;
  end: number;
  uses: Set<"T" | "t">;
  body: { kind: "block"; open: number; firstStatement: number } | { kind: "expr"; start: number; end: number };
};

/** Unwrap memo(fn) / forwardRef(fn) / React.memo(fn). */
function unwrap(e: ts.Expression): ts.Expression {
  let n = e;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n)) { n = n.expression; continue; }
    if (ts.isCallExpression(n) && n.arguments[0] && /^(React\.)?(memo|forwardRef)$/.test(n.expression.getText())) { n = n.arguments[0]; continue; }
    return n;
  }
}

/** Top-level PascalCase functions and arrows: the places a hook may be inserted. */
function findComponents(sf: ts.SourceFile): Component[] {
  const out: Component[] = [];
  const add = (name: string, fn: ts.FunctionLikeDeclaration) => {
    if (!fn.body) return;
    const start = fn.getStart(sf);
    const end = fn.getEnd();
    if (ts.isBlock(fn.body)) {
      const first = fn.body.statements[0];
      out.push({ name, start, end, uses: new Set(), body: { kind: "block", open: fn.body.getStart(sf) + 1, firstStatement: first ? first.getStart(sf) : fn.body.getEnd() - 1 } });
    } else {
      out.push({ name, start, end, uses: new Set(), body: { kind: "expr", start: fn.body.getStart(sf), end: fn.body.getEnd() } });
    }
  };
  for (const s of sf.statements) {
    if (ts.isFunctionDeclaration(s)) {
      const name = s.name?.text ?? "default";
      if (name === "default" || /^[A-Z]/.test(name)) add(name, s);
    } else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !/^[A-Z]/.test(d.name.text) || !d.initializer) continue;
        const init = unwrap(d.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) add(d.name.text, init);
      }
    } else if (ts.isExportAssignment(s) && !s.isExportEquals) {
      const init = unwrap(s.expression);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) add("default", init);
    }
  }
  return out;
}

main();
