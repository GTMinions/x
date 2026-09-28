/**
 * validate-content — the hard gate.
 *
 * For every product's research content it checks:
 *   1. every edge references an existing entity slug
 *   2. every edge rel ∈ {uses, depends-on, peer-of, cited-by, acquired-by}
 *   3. every [[pill]] in prose resolves to an existing entity (pill-gap = 0)
 *   4. every entity has a valid depth_score (0–10) and a last_updated date
 *   5. every architecture layer rests on entities that exist
 *
 * Exits 1 on any error so `pnpm build` fails closed.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEntities, loadEdges } from "../app/_platform/research/engine";
import { REL_TYPES, type Entity, type Section } from "../app/_platform/research/types";
import { gateFor } from "../app/_platform/research/depth";
import { loadArchitecture, VIEWS } from "../app/_platform/research/architecture";
import { productsWithResearch } from "./_scan";
import { blockFor, unassignedScopes } from "../app/_platform/wishes/ids";

const PILL_RE = /\[\[([a-z0-9-]+)\]\]/g;
const errors: string[] = [];
const warnings: string[] = [];

function pillsIn(text: string | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(PILL_RE)].map((m) => m[1]);
}

const SECTIONS = ["abstract", "background", "mechanism", "results", "discussion", "conclusion"] as const;

/**
 * Every string on `Entity` that a human writes, and therefore every one that can carry
 * a pill. Not a curated subset — the whole surface.
 *
 * Two earlier versions of this function claimed exactly that and were wrong, each in the
 * same way: someone enumerated the fields they were thinking about, wrote a comment
 * asserting completeness, and shipped. The first missed the notes under formulas and
 * benchmarks and all the prose inside components. The second added those, re-asserted
 * completeness, and still missed `thesis` — the single most load-bearing sentence a MOC
 * has — along with `subtitle`, `data_points`, and `discovered_not_added[].why_not`, which
 * had a live unresolvable pill in it at the time.
 *
 * So this no longer hand-lists. It walks the object and collects every string it finds,
 * which means a prose field added to `Entity` tomorrow is gated the day it is added, by
 * nobody remembering to do anything. The keys skipped below are the ones whose contents
 * are not prose: a `[[...]]` inside them would be data, not a link.
 */
const NOT_PROSE = new Set(["slug", "url", "diagram_svg", "citations", "edges", "tags"]);

function allPills(e: Entity): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key?: string) => {
    if (key && NOT_PROSE.has(key)) return;
    if (typeof v === "string") out.push(...pillsIn(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
    }
  };
  walk(e);
  return out;
}


/** Every prose string on an entity, with its JSON path — for invariant checks. */
function proseStrings(e: Entity): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (v: unknown, key?: string, path = "") => {
    if (key && NOT_PROSE.has(key)) return;
    if (typeof v === "string") out.push([path || key || "?", v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, key, `${path}[${i}]`));
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k, path ? `${path}.${k}` : k);
  };
  walk(e);
  return out;
}

for (const product of productsWithResearch()) {
  const entities = loadEntities(product);
  const edges = loadEdges(product);
  const slugs = new Set(entities.map((e) => e.slug));

  const inbound: Record<string, number> = {};
  const outbound: Record<string, number> = {};
  for (const e of edges) {
    inbound[e.to] = (inbound[e.to] ?? 0) + 1;
    outbound[e.from] = (outbound[e.from] ?? 0) + 1;
  }

  let overclaimed = 0;

  // A file whose slug does not match its own filename is a write that landed on the wrong
  // path. It destroys one entity, duplicates another, and passes every other gate in this
  // repo: the pills still resolve, the depth still audits, the build still compiles. It
  // happened — agent-extensibility.json was overwritten byte-for-byte with
  // agent-framework-atoms.json, and the only symptom a reader would ever see was the same
  // MOC rendering twice in the index.
  const dir = path.join(process.cwd(), "app", "(products)", product, "research", "content", "entities");
  const seen = new Map<string, string>();
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith(".json")) : []) {
    let slug: string | undefined;
    try {
      slug = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).slug;
    } catch (err) {
      // A malformed entity file should fail the gate with its own name, not a stack trace.
      errors.push(`[${product}] ${f}: not valid JSON (${(err as Error).message.split("\n")[0]})`);
      continue;
    }
    const expected = f.replace(/\.json$/, "");
    if (!slug) {
      errors.push(`[${product}] ${f}: no slug`);
      continue;
    }
    if (slug !== expected)
      errors.push(`[${product}] ${f}: slug is "${slug}" — the file was written to the wrong path`);
    if (seen.has(slug))
      errors.push(`[${product}] duplicate slug "${slug}": ${seen.get(slug)} and ${f} claim the same entity`);
    seen.set(slug, f);
  }

  for (const e of entities) {
    if (typeof e.depth_score !== "number" || e.depth_score < 0 || e.depth_score > 10)
      errors.push(`[${product}] ${e.slug}: depth_score must be 0–10 (got ${e.depth_score})`);
    if (!e.last_updated) errors.push(`[${product}] ${e.slug}: missing last_updated`);
    for (const pill of allPills(e)) {
      if (!slugs.has(pill)) errors.push(`[${product}] ${e.slug}: unresolved pill [[${pill}]]`);
    }

    // A prior_art item can name the entity it was chosen over via `ref_slug` — the same
    // dangling-reference class as a pill, but in structured data the pill scan never reaches
    // (it walks prose strings, not this field). An unresolved ref_slug renders nothing today,
    // which is exactly why 38 of them rotted here unseen; gate it like a pill so the next one
    // fails the build instead of accumulating.
    for (const c of e.components ?? []) {
      for (const pa of c.prior_art ?? []) {
        if (pa.ref_slug && !slugs.has(pa.ref_slug))
          errors.push(`[${product}] ${e.slug}: unresolved prior_art ref_slug "${pa.ref_slug}" (component "${c.name}")`);
      }
    }

    // An entity must not cite the same URL twice. Duplicates ACROSS entities are fine and
    // common (one earnings release legitimately grounds many companies) and are NOT checked —
    // the old "global citation-URL dedup fails the build" belief was false (s683). But the SAME
    // url twice WITHIN one entity is two identical links in its own source list: redundant, and
    // the tell of a citation appended twice with drifting labels/dates. 14 such pairs had
    // accumulated unseen; gate the narrow-true invariant so the next one fails the build.
    const citedUrls = new Set<string>();
    for (const c of e.citations ?? []) {
      const u = c.url?.trim();
      if (!u) continue;
      if (citedUrls.has(u)) errors.push(`[${product}] ${e.slug}: cites the same URL twice — ${u}`);
      citedUrls.add(u);
    }

    // The renderer's invariants, as a gate.
    //
    // renderInline tokenises on `**…**`, `` `…` `` and `[[…]]` in one pass. That is only
    // safe while the markers are balanced: an odd `**` silently bolds everything up to the
    // next one — across fields, since swot items and benchmark values are rendered with no
    // paragraph split — and `***x***` matches as `***x**` plus a stray `*` that a
    // zero-raw-marker render check cannot see, because the leaked glyph is a single asterisk.
    //
    // This is the grep that is actually load-bearing. It checks an invariant of the renderer
    // rather than a spelling of the content, which is the difference between the checks that
    // held this slot and the ones that did not.
    for (const [path, text] of proseStrings(e)) {
      if (text.includes("***"))
        errors.push(`[${product}] ${e.slug}: \`***\` in ${path} — renderInline leaks a stray asterisk`);
      if ((text.match(/\*\*/g)?.length ?? 0) % 2 !== 0)
        errors.push(`[${product}] ${e.slug}: odd count of \`**\` in ${path} — bold runs past its field`);
      if ((text.match(/`/g)?.length ?? 0) % 2 !== 0)
        errors.push(`[${product}] ${e.slug}: odd count of backticks in ${path}`);
    }

    // A MOC's thesis renders inside a <Link> on /launch. A pill there would emit a nested
    // <a>, which the parser hoists apart and hydration then disagrees with. No thesis carries
    // one today — that was luck, and luck is not an invariant.
    if (e.entity_kind === "moc" && /\[\[[a-z0-9-]+\]\]/.test(e.thesis ?? ""))
      errors.push(`[${product}] ${e.slug}: a MOC thesis cannot carry a [[pill]] — it renders inside a link`);

    // Placement — hard, because a broken reference is a broken page.
    if ((e.belongs_to?.length ?? 0) > 2)
      errors.push(`[${product}] ${e.slug}: belongs_to caps at 2 MOCs (got ${e.belongs_to!.length})`);
    for (const moc of e.belongs_to ?? [])
      if (!slugs.has(moc)) errors.push(`[${product}] ${e.slug}: belongs_to unknown MOC "${moc}"`);
    for (const rel of e.related ?? [])
      if (!slugs.has(rel)) errors.push(`[${product}] ${e.slug}: related to unknown entity "${rel}"`);

    // A MOC's members must resolve — an unresolvable row makes the comparison a lie.
    if (e.entity_kind === "moc") {
      if (!e.thesis?.trim())
        errors.push(`[${product}] ${e.slug}: a MOC needs a thesis — a claim you can disagree with`);
      if ((e.members?.length ?? 0) < 3)
        errors.push(`[${product}] ${e.slug}: a MOC needs ≥3 members (fewer than that is not a map)`);
      for (const m of e.members ?? []) {
        if (!slugs.has(m.slug)) errors.push(`[${product}] ${e.slug}: MOC member "${m.slug}" does not exist`);
        if (!m.claim?.trim())
          errors.push(`[${product}] ${e.slug}: MOC member "${m.slug}" has no claim — a list is not a map`);
      }
    }

    // Research quality is a backlog, not a build break. An entity claiming a rung
    // it has not earned is the first thing to fix, but failing the build on it
    // would mean no build ever passes on an honest corpus.
    if (gateFor(e, { inbound: inbound[e.slug] ?? 0, outbound: outbound[e.slug] ?? 0 }).overclaimed.length > 0)
      overclaimed += 1;
  }

  for (const edge of edges) {
    if (!slugs.has(edge.from)) errors.push(`[${product}] edge from unknown entity: ${edge.from}`);
    if (!slugs.has(edge.to)) errors.push(`[${product}] edge to unknown entity: ${edge.to}`);
    if (!REL_TYPES.includes(edge.rel)) errors.push(`[${product}] edge ${edge.from}→${edge.to}: illegal rel "${edge.rel}"`);
  }

  // An architecture layer must rest on entities that exist. A layer citing a slug
  // that resolves to nothing is a drawing — the whole point of the page is that
  // the research under a layer is what licenses its commitment, so the reference
  // has to be real. Absence of architecture.json is legal; a broken one is not.
  const arch = loadArchitecture(product);
  let layerCount = 0;
  if (arch) {
    for (const view of VIEWS) {
      const layers = arch[view]?.layers ?? [];
      layerCount += layers.length;
      const layerSlugs = new Set(layers.map((l) => l.slug));
      const seen = new Set<string>();
      for (const l of layers) {
        const at = `[${product}] architecture.${view}.${l.slug}`;
        if (seen.has(l.slug)) errors.push(`${at}: duplicate layer slug`);
        seen.add(l.slug);
        if (!l.name?.trim()) errors.push(`${at}: missing name`);
        if (!l.one_line?.trim()) errors.push(`${at}: missing one_line`);
        if (!l.commitment?.trim())
          errors.push(`${at}: missing commitment — a layer that promises nothing is a label`);
        if ((l.entities?.length ?? 0) < 1)
          errors.push(`${at}: needs ≥1 research entity — a layer resting on nothing cannot be defended`);
        for (const s of l.entities ?? [])
          if (!slugs.has(s)) errors.push(`${at}: entity "${s}" does not exist`);
        for (const dep of l.depends_on ?? []) {
          if (dep === l.slug) errors.push(`${at}: depends_on itself`);
          else if (!layerSlugs.has(dep))
            errors.push(`${at}: depends_on unknown layer "${dep}" (must be a layer in the same view)`);
        }
      }
    }
  }

  if (overclaimed > 0)
    warnings.push(
      `[${product}] ${overclaimed}/${entities.length} entities claim a depth their content does not support` +
        ` — run \`pnpm research:audit\` for the list`,
    );

  console.log(
    `  ✓ ${product}: ${entities.length} entities, ${edges.length} edges` +
      (layerCount ? `, ${layerCount} architecture layers` : ""),
  );
}

/**
 * Every product needs its own wish-id block.
 *
 * Wish ids are partitioned by product so uniqueness needs no cross-database
 * check (app/_platform/wishes/ids.ts). A product with no block shares the
 * fallback one with every other unassigned product, and then the only thing
 * keeping two of them apart is a PRIMARY KEY in two SEPARATE databases — which
 * keeps nothing apart at all. Caught here because the failure is silent
 * otherwise: it looks fine until two products mint the same id.
 */
{
  // Products with pages in code. A product created at runtime has no folder and
  // gets its block from the registry (app/lib/registry/core.ts), which this
  // build-time check cannot reach; the code table only has to cover the coded ones.
  const scopes = ["site", ...productsWithResearch()];
  const missing = unassignedScopes(scopes);
  if (missing.length) {
    errors.push(
      `wish id blocks: no block assigned for ${missing.join(", ")}. ` +
        "Add one to WISH_ID_BLOCKS in app/_platform/wishes/ids.ts (append a new number; never reuse).",
    );
  }
  const blocks = scopes.map((s) => [s, blockFor(s)] as const);
  const byBlock = new Map<number, string[]>();
  for (const [scope, b] of blocks) byBlock.set(b, [...(byBlock.get(b) ?? []), scope]);
  for (const [b, sharing] of byBlock) {
    if (sharing.length > 1) {
      errors.push(`wish id blocks: ${sharing.join(" and ")} both use block ${b} — their ids would collide.`);
    }
  }
}

/**
 * Every product page must go through `ProductShell`.
 *
 * ProductShell is where the access gate lives (app/lib/access.ts): it refuses
 * a private product before rendering `children`, so a page that renders its
 * body some other way serves that product's data to anyone signed in.
 *
 * The gate is per-page by necessity — the `(products)` route group has no
 * dynamic segment, so its layout cannot know which product it is wrapping.
 * That makes "a new page forgot" a real and silent failure mode, so it is
 * checked here rather than trusted.
 */
{
  const ROOT = process.cwd();
  const pagesRoot = path.join(ROOT, "app", "(products)");
  const pages: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") pages.push(full);
    }
  };
  if (fs.existsSync(pagesRoot)) walk(pagesRoot);

  const unguarded = pages.filter((f) => !fs.readFileSync(f, "utf8").includes("ProductShell"));
  for (const f of unguarded) {
    errors.push(
      `access: ${path.relative(ROOT, f)} does not use ProductShell, so it renders a product ` +
        "without the access gate. Wrap its body in <ProductShell slug={…}>.",
    );
  }
  if (pages.length && !unguarded.length) {
    console.log(`  ✓ access: ${pages.length} product pages all wrap in ProductShell`);
  }
}

/**
 * The platform must not say what it is built on.
 *
 * WHY THIS IS A BUILD GATE AND NOT A STYLE NOTE
 * Which worker builds a wish, and what that worker runs on, is the operator's
 * choice — this codebase is deployed by other people who will make a different
 * one, and a user of the hosted site has no reason to be told either. The
 * problem is that the answer leaks in exactly the places nobody re-reads: a
 * doctrine comment explaining an economic decision, an error string naming the
 * vendor whose key was rejected, a placeholder in a form field. Each is
 * harmless-looking and each is a disclosure.
 *
 * So it is checked mechanically. Scoped to the platform's own machinery, and
 * NOT to research content, which cites and analyses AI companies as its subject
 * matter — an entity about a model vendor is the corpus working correctly, and
 * a rule that could not tell the two apart would be turned off within a week.
 */
{
  const ROOT = process.cwd();
  // Where the leak matters: shared engine, libraries, routes, tooling. Research
  // content and the agent org are excluded — one is the subject, the other is a
  // documented feature of the repository.
  const scanRoots = [
    path.join(ROOT, "app", "_platform"),
    path.join(ROOT, "app", "lib"),
    path.join(ROOT, "app", "api"),
    path.join(ROOT, "app", "about"),   // the roster is public; what it runs on is not
    path.join(ROOT, "scripts"),
    // The doctrine a worker follows is a public repository file that explains
    // the protocol, so it is exactly where a runner's name would leak next. It
    // was under `.claude/` — outside the gate — until it moved here to be read
    // by runners that owe that directory nothing.
    path.join(ROOT, "cronjobs"),
  ];
  const SKIP = [
    path.join("app", "_platform", "research"),   // cites vendors as research subjects
    path.join("app", "(products)"),
  ];

  const VENDORS = /\b(anthropic|openai|claude|chatgpt|gpt-4|gpt-5|codex|gemini|copilot)\b/i;
  /**
   * Business-model wording that gives the runner away without naming a brand.
   *
   * PHRASES, not the bare word `subscription`. This started as the word, and
   * that was right while the platform sold nothing: any mention of a
   * subscription could only be describing what the worker ran on. Once the
   * platform started selling subscriptions of its own, the bare word became a
   * legitimate domain term — `app/lib/stripe.ts` is full of it — and a rule
   * that fires on legitimate use is a rule somebody switches off.
   *
   * So it matches the constructions that describe the RUNNER, and leaves the
   * ones that describe a customer's plan alone. Widening this back to a bare
   * word would make the gate noisy; narrowing it further would let
   * "the loop runs on a subscription" through. Both directions have been tried.
   */
  const TELLS = /(console session|subscription (worker|session|account|capacity)|(runs?|running|ran|built|hosted) on a (flat[- ]rate )?subscription|our subscription|the subscription's)/i;

  const files: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(ROOT, full);
      // This file states the rule, so it necessarily contains the words the
      // rule forbids.
      if (full === __filename || e.name === "validate-content.ts") continue;
      if (SKIP.some((sk) => rel.startsWith(sk))) continue;
      if (e.isDirectory()) walk(full);
      // Markdown counts. The rule is about what a reader can infer, and a reader
      // infers it from prose sooner than from a type signature — the doctrine,
      // the README, the contributing guide are all read before any code is.
      else if (/\.(ts|tsx|md)$/.test(e.name)) files.push(full);
    }
  };
  scanRoots.forEach(walk);
  // The three documents a reader opens first, named rather than walked so that
  // scanning the root does not mean scanning everything under it. A leak here
  // reaches more people than a leak anywhere in the tree.
  for (const doc of ["README.md", "CONTRIBUTING.md", "CLAUDE.md", ".env.example"]) {
    const full = path.join(ROOT, doc);
    if (fs.existsSync(full)) files.push(full);
  }

  let hits = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    fs.readFileSync(f, "utf8").split("\n").forEach((line: string, i: number) => {
      // A path like `.claude/skills/...` is a real directory in this repo and
      // names a file, not a runtime. The env-var and config names that carry a
      // vendor are the operator's own configuration, not a statement to a user.
      // `CLAUDE.md` joins them once markdown is scanned: it is the architecture
      // document's filename, fixed by the tooling that reads it, and naming a
      // file in this repository tells a reader nothing about what runs a wish.
      if (/\.claude\b|CLAUDE\.md/.test(line) || /ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_GENAI/.test(line)) return;
      const m = line.match(VENDORS) ?? line.match(TELLS);
      if (!m) return;
      hits++;
      errors.push(
        `disclosure: ${rel}:${i + 1} says "${m[0]}" — the platform must not reveal what builds a ` +
          "wish, in code or in copy. Say what capacity costs, not who supplies it.",
      );
    });
  }
  if (!hits) console.log(`  ✓ disclosure: ${files.length} platform files name no runner or vendor`);

  /**
   * The OTHER thing a public repository must not carry: this operator's
   * commercial figures.
   *
   * Prices, quotas, and tier definitions live in the `tiers` table and the
   * settings table precisely so that a clone reveals none of them. What kept
   * leaking back in was subtler — measured cost data written into COMMENTS while
   * explaining why a design is the way it is. The reasoning belongs in the
   * repository; the numbers it was derived from are the operator's.
   *
   * Matched narrowly, because a rule that fires on legitimate use is a rule
   * somebody switches off: a large comma-formatted number only counts when the
   * same line is talking about tokens, wishes, or spend. That leaves colour
   * literals and the research validators' competitor-pricing examples alone —
   * a vendor's published price is corpus content, not this deployment's cost.
   */
  const BIG_FIGURE = /\b\d{1,3}(,\d{3}){2,}\b/;
  const ABOUT_MONEY = /\b(tokens?|wish(es)?|cache|spend|cost)\b/i;
  let figures = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    fs.readFileSync(f, "utf8").split("\n").forEach((line: string, i: number) => {
      if (/rgba?\(/.test(line)) return;
      const m = line.match(BIG_FIGURE);
      if (!m || !ABOUT_MONEY.test(line)) return;
      figures++;
      errors.push(
        `commercial figures: ${rel}:${i + 1} carries "${m[0]}" beside a cost word — a measured ` +
          "token or spend figure is this deployment's data, not the platform's. Keep the reasoning, drop the number.",
      );
    });
  }
  if (!figures) console.log(`  ✓ commercial: ${files.length} platform files carry no measured cost figure`);

  /**
   * Every platform page wears the site chrome.
   *
   * A page without it renders as a bare column on a white field — no nav, no
   * way back, no profile menu. That is not a visual nit: it is a dead end, and
   * it happens by omission rather than by decision, which is exactly the kind
   * of failure a gate catches better than a reviewer.
   *
   * `/sign-in` is the one exemption and says so in its own header: a nav there
   * offers a half-signed-in visitor somewhere else to go mid-flow.
   */
  const CHROME = /SiteChrome|SiteNav|SettingsShell|ProductShell/;
  /** A page that only redirects has no UI to put a header on. Recognised by
   *  shape rather than listed by name: the exemption should follow the code,
   *  not a file path somebody has to remember to update. */
  const REDIRECT_ONLY = /\bredirect\((?!.*\/\/)/;
  const CHROME_EXEMPT = [path.join("app", "sign-in", "page.tsx")];
  const pages: string[] = [];
  const walkPages = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(ROOT, full);
      // Products carry their own shell, enforced by the access check above.
      if (rel.startsWith(path.join("app", "(products)"))) continue;
      if (e.isDirectory()) walkPages(full);
      else if (e.name === "page.tsx") pages.push(full);
    }
  };
  walkPages(path.join(ROOT, "app"));

  let bare = 0;
  for (const f of pages) {
    const rel = path.relative(ROOT, f);
    if (CHROME_EXEMPT.includes(rel)) continue;
    const src = fs.readFileSync(f, "utf8");
    if (CHROME.test(src)) continue;
    if (REDIRECT_ONLY.test(src) && !/<[a-z]/.test(src)) continue;
    bare++;
    errors.push(
      `chrome: ${rel} renders no site header — wrap it in SiteChrome, SiteNav or ` +
        "SettingsShell, or add it to CHROME_EXEMPT with a reason in the file.",
    );
  }
  if (!bare) console.log(`  ✓ chrome: ${pages.length} platform pages all render a header`);

  /**
   * A page with a header carries the operator dock too.
   *
   * The dock is where Design Mode, view-as and the build light live, and it is
   * mounted per page rather than in the root layout (the layout is a server
   * component and cannot hold the client state Design Mode needs). That makes
   * "this page forgot it" a silent omission: the page looks right, and the
   * tools are just missing on it — which is exactly how the landing page
   * shipped without them.
   *
   * Settings pages are exempt: `SettingsShell` is its own chrome with its own
   * rail, and the dock's wish CTA has no meaning inside a settings tree.
   */
  let dockless = 0;
  for (const f of pages) {
    const rel = path.relative(ROOT, f);
    if (CHROME_EXEMPT.includes(rel)) continue;
    const src = fs.readFileSync(f, "utf8");
    if (!/SiteChrome|SiteNav/.test(src)) continue;         // settings + products
    if (/SiteDockMount/.test(src)) continue;
    if (REDIRECT_ONLY.test(src) && !/<[a-z]/.test(src)) continue;
    dockless++;
    errors.push(
      `chrome: ${rel} renders a site header but no operator dock — pass ` +
        "`dock={<SiteDockMount canDesign={design} />}` to SiteChrome, or the tools are missing on this page.",
    );
  }
  if (!dockless) console.log(`  ✓ dock: every site-chrome page mounts the operator dock`);
}

if (warnings.length) {
  console.warn(`\n! validate-content: ${warnings.length} warning(s)\n` + warnings.map((w) => "  - " + w).join("\n"));
}
if (errors.length) {
  console.error(`\n✗ validate-content: ${errors.length} error(s)\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log("✓ validate-content: all research content valid");
