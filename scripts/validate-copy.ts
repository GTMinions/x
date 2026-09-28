/**
 * Copy gate — every content id a product's pages name must have a row.
 *
 * The pages in git carry ids; the words live in `_copy.json`, pulled from the
 * product's `ui_copy` table before a build. An id with no row renders as
 * itself in brackets, which is honest but not shippable, so this fails the
 * build when the working copy is present and a page names an id it lacks.
 *
 * A checkout with no credentials has no `_copy.json` at all. That is reported,
 * not failed: the page renders ids, the same posture the data-module stubs
 * take (a build should not need the content to compile).
 *
 * Rows no page names are a warning — usually a string that was deleted from a
 * page and not from the file; `product:db push` drops them from the table.
 *
 * Usage: npx tsx scripts/validate-copy.ts [slug …]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PRODUCTS_DIR = path.join(ROOT, "app", "(products)");

// Any string literal shaped like an id (`<slug>.<page>.<tag>-<n>`) counts as
// naming it — `<T id="…">`, `t("…")`, and an id kept in a constant and looked
// up later (`label: "ai-edu.lesson.readinglevel.label-1"`) all read the same.
const ID_RE = /["'`]([a-z0-9-]+(?:\.[a-z0-9_-]+)+-\d+)["'`]/g;
const SCOPE_RE = /<CopyScope\s[^>]*?\bprefix=["']([a-z0-9-]+(?:\.[a-z0-9_-]+)*)["']/g;

function walk(dir: string, out: string[]) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    // The site walk starts at app/ and must not descend into the products, nor
    // into the copy engine itself, whose comments quote ids as examples.
    if (e.isDirectory() && e.name === "(products)") {
      const g = path.join(full, "[slug]");
      if (fs.existsSync(g)) walk(g, out);
      continue;
    }
    if (e.isDirectory() && full.endsWith(path.join("_platform", "copy"))) continue;
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(full);
  }
}

/** Every product folder, plus `site` — the platform's own pages under app/. */
function products(): string[] {
  return [
    ...fs
      .readdirSync(PRODUCTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("[") && !e.name.startsWith("."))
      .map((e) => e.name),
    "site",
  ];
}

const productDir = (slug: string) => (slug === "site" ? path.join(ROOT, "app") : path.join(PRODUCTS_DIR, slug));

let failed = false;
const only = process.argv.slice(2);

for (const slug of only.length ? only : products()) {
  const dir = productDir(slug);
  if (!fs.existsSync(dir)) {
    console.error(`✗ no product at ${path.relative(ROOT, dir)}`);
    failed = true;
    continue;
  }
  const files: string[] = [];
  walk(dir, files);
  const named = new Map<string, string>(); // id → first file
  const scopes: { prefix: string; file: string }[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(ID_RE)) if (!named.has(m[1]!)) named.set(m[1]!, path.relative(ROOT, f));
    for (const m of src.matchAll(SCOPE_RE)) scopes.push({ prefix: m[1]!, file: path.relative(ROOT, f) });
  }

  const copyPath = path.join(dir, "_copy.json");
  if (!fs.existsSync(copyPath)) {
    console.log(`  ${slug}: ${named.size} ids in pages, no _copy.json (no credential?) — pages will render ids`);
    continue;
  }
  let rows: Record<string, string>;
  try {
    rows = JSON.parse(fs.readFileSync(copyPath, "utf8"));
  } catch (err) {
    console.error(`✗ ${slug}: _copy.json is not valid JSON: ${(err as Error).message}`);
    failed = true;
    continue;
  }

  const wrongProduct = [...named.keys()].filter((id) => !id.startsWith(`${slug}.`));
  const missing = [...named.keys()].filter((id) => id.startsWith(`${slug}.`) && typeof rows[id] !== "string");
  const orphan = Object.keys(rows).filter((id) => !named.has(id));
  const emptyScopes = scopes.filter((s) => !Object.keys(rows).some((id) => id.startsWith(s.prefix)));

  for (const id of wrongProduct) {
    console.error(`✗ ${slug}: ${named.get(id)} names ${id}, which belongs to another product`);
    failed = true;
  }
  for (const id of missing) {
    console.error(`✗ ${slug}: ${named.get(id)} names ${id} but _copy.json has no such row`);
    failed = true;
  }
  for (const s of emptyScopes) console.warn(`  ! ${slug}: ${s.file} scopes "${s.prefix}" but no row starts with it`);
  if (orphan.length) console.warn(`  ! ${slug}: ${orphan.length} row(s) no page names (push removes them): ${orphan.slice(0, 5).join(", ")}${orphan.length > 5 ? " …" : ""}`);
  console.log(`  ${slug}: ${named.size} ids in ${files.length} files, ${Object.keys(rows).length} rows${missing.length ? "" : " — ok"}`);
}

if (failed) {
  console.error("\ncopy gate failed");
  process.exit(1);
}
