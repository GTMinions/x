/**
 * Making a product real: a database of its own, a row in the registry, and —
 * for the demo — its content.
 *
 * Every action here is a site-admin action. It needs the Turso variables (to
 * create the database) and, on Vercel, benefits from the Vercel ones (to store
 * the site credentials and to redeploy). Content is pulled from the databases
 * at BUILD time, so a product provisioned at runtime shows its pages only
 * after the next build: locally that is `pnpm product:db pull <slug>` and a
 * restart, on Vercel a redeploy — which this module triggers when it can.
 */
import "server-only";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { createClient } from "@libsql/client";
import { exportBundle, importBundle, migrateContent, type BundleCounts, type ProductBundle } from "./content-db";
import { fetchProduct, localTarget, nextWishBlock, registryMode, upsertProduct, upsertTeam, type Product } from "./registry/core";
import { invalidateRegistry } from "./registry";
import { dbName, ensureDatabase, groupToken, tursoAutoProvision } from "./turso";
import { onVercel, redeploy, setVercelEnv, vercelConfigured } from "./vercel";
import { isSiteAdmin, type Session } from "./auth";
import { roleAtLeast } from "./memberships";
import { DEMO_SLUG } from "./setup";

export const DEFAULT_TEAM = { slug: "growth-labs", name: "Growth Labs" };

/** Session-minted admin, or one granted through settings / SITE_ADMIN_EMAILS. */
export async function isSetupAdmin(session: Session | null): Promise<boolean> {
  if (isSiteAdmin(session)) return true;
  if (!session?.email) return false;
  return roleAtLeast(session.email, "site", "site", "admin");
}

export type NextStep =
  | { kind: "redeployed"; url: string }
  | { kind: "redeploy" }
  | { kind: "pulled"; slug: string }
  | { kind: "pull"; command: string };

/** What has to happen for a new product's pages to render. */
async function afterProvision(slug: string): Promise<NextStep> {
  if (!onVercel()) {
    // On a machine with a writable checkout the site can pull for itself, so
    // the product's pages are on disk the moment the button returns. The dev
    // server picks the files up; a production start needs a restart.
    const pulled = await pullLocally(slug);
    return pulled ? { kind: "pulled", slug } : { kind: "pull", command: `pnpm product:db pull ${slug}` };
  }
  if (!vercelConfigured()) return { kind: "redeploy" };
  const d = await redeploy();
  return { kind: "redeployed", url: d.url };
}

/**
 * The site database. Created through Turso, and its two variables stored on
 * Vercel when the site can; either way the caller gets them to put in
 * `.env.local`. The values are returned ONCE, to the admin who clicked.
 */
export async function createSiteDatabase(): Promise<{ vars: Record<string, string>; storedOnVercel: boolean; existed: boolean }> {
  if (!tursoAutoProvision()) throw new Error("local mode: the site database is a file under .local-db/ and needs no creating. Set TURSO_API_TOKEN and TURSO_ORG for a hosted one.");
  const db = await ensureDatabase("site");
  // Naming it is optional — the app reaches `<prefix>-site` through the Turso
  // token on its own — but naming it pins the registry to one database for good.
  const vars = { PRODUCT_DB_SITE_URL: db.url, PRODUCT_DB_SITE_TOKEN: await groupToken() };
  let storedOnVercel = false;
  if (vercelConfigured()) {
    await setVercelEnv(Object.entries(vars).map(([key, value]) => ({ key, value })));
    storedOnVercel = true;
  }
  return { vars, storedOnVercel, existed: true };
}

/** `pnpm product:db pull <slug>` in-process, when the checkout is at hand. */
function pullLocally(slug: string): Promise<boolean> {
  const script = path.join(process.cwd(), "scripts", "product-db.ts");
  if (!fs.existsSync(script)) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("npx", ["tsx", script, "pull", slug, "--force"], { cwd: process.cwd(), timeout: 120_000, env: process.env }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`[provision] could not pull ${slug} locally:`, (stderr || err.message).trim().split("\n")[0]);
        resolve(false);
      } else {
        console.log(`[provision] ${stdout.trim().split("\n").pop()}`);
        resolve(true);
      }
    });
  });
}

function demoBundlePath(slug: string): string {
  return path.join(process.cwd(), "demo", `${slug}.json`);
}

export function demoBundleAvailable(slug = DEMO_SLUG): boolean {
  return fs.existsSync(demoBundlePath(slug));
}

/** Provision the product's database and register it; the content is the caller's. */
async function provisionProduct(p: Product): Promise<{ url: string; token: string }> {
  // Hosted mode: a Turso database of its own, reached with the group token, so
  // the row carries the URL only. Local mode: a SQLite file under .local-db/.
  const db = tursoAutoProvision() ? await ensureDatabase(p.slug) : { ...localTarget(p.slug), authToken: undefined };
  const client = createClient({ url: db.url, authToken: db.authToken });
  await migrateContent(client);
  await upsertTeam(DEFAULT_TEAM);
  await upsertProduct({ ...p, dbUrl: db.url, wishBlock: p.wishBlock ?? (await nextWishBlock()) });
  invalidateRegistry();
  console.log(`[provision] ${tursoAutoProvision() ? dbName(p.slug) : db.url} ready for ${p.slug} (${registryMode()} mode)`);
  return { url: db.url, token: db.authToken ?? "" };
}

/** The demo product, from the bundle in demo/, into a database of its own. */
export async function loadDemoProduct(): Promise<{ product: Product; counts: BundleCounts; next: NextStep }> {
  const file = demoBundlePath(DEMO_SLUG);
  if (!fs.existsSync(file)) throw new Error(`no demo bundle at demo/${DEMO_SLUG}.json`);
  const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as ProductBundle;
  const creds = await provisionProduct(bundle.product);
  const counts = await importBundle(createClient({ url: creds.url, authToken: creds.token }), bundle);
  return { product: bundle.product, counts, next: await afterProvision(DEMO_SLUG) };
}

const SLUG_RE = /^[a-z][a-z0-9-]{1,30}$/;
const RESERVED = new Set(["site", "about", "settings", "sign-in", "wishes", "setup", "api", "slides", "demo"]);

/** An empty product: a database, a registry row, and the generic pages. */
export async function createProduct(input: { slug: string; name: string; tagline?: string; accent?: string }): Promise<{ product: Product; next: NextStep }> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) throw new Error("a slug is 2–31 characters: lowercase letters, digits and dashes, starting with a letter");
  if (RESERVED.has(slug)) throw new Error(`"${slug}" is a platform route, not a product`);
  if (await fetchProduct(slug)) throw new Error(`a product called "${slug}" already exists`);
  const name = input.name.trim();
  if (!name) throw new Error("a product needs a name");
  const accent = /^#[0-9a-f]{6}$/i.test(input.accent ?? "") ? input.accent! : "#356a4d";
  const product: Product = {
    slug, name, tagline: (input.tagline ?? "").trim(), accent, teamSlug: DEFAULT_TEAM.slug,
    // Private until its owner says otherwise: a new product is somebody's work, not a demo.
    status: "active", visibility: "private", hasResearch: true,
  };
  await provisionProduct(product);
  return { product, next: await afterProvision(slug) };
}

/** A product's whole database as one document — what `demo/` holds for the demo. */
export async function exportProduct(slug: string): Promise<ProductBundle> {
  const row = await fetchProduct(slug);
  if (!row?.dbUrl) throw new Error(`no database registered for ${slug}`);
  const { dbUrl: _u, dbToken: _t, ...product } = row;
  return exportBundle(createClient({ url: row.dbUrl, authToken: row.dbToken ?? (tursoAutoProvision() ? await groupToken() : undefined) }), product);
}
