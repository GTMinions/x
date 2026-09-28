/**
 * Product registry — the multi-tenant platform spine.
 *
 * A **product** is an isolated demo living at app/(products)/<slug>/ (its
 * pages) with a database of its own (its content, data and words). Every
 * product automatically gets the platform's cross-cutting surfaces: a research
 * site, a launch layer, a roadmap, a wishlist and a changelog.
 *
 * WHAT IS A PRODUCT
 * A row in the site database (see ./registry). Not a folder, not an entry in
 * this file: the folder is optional (a product without one renders through
 * the generic routes under app/(products)/[slug]), and the list is read at
 * request time, so a product created on /setup exists without a code change
 * and a product whose database this deployment cannot reach is not listed.
 * `listProducts` and friends are async for that reason.
 */
export type { Product, Team, ProductStatus, Visibility } from "./registry/core";
export { listProducts, getProduct, listTeams, getTeam } from "./registry";
import type { Product } from "./registry/core";

/**
 * Site-level configuration (the top scope in site → team → product → workspace).
 *
 * The bootstrap admin list is deliberately NOT here. It is a deployment fact, not a
 * source fact: a hardcoded address makes every fork inherit someone else's owner.
 * It reads from `SITE_ADMIN_EMAILS` at the one place that needs it — the seed in
 * `./memberships`, which is `server-only` and so cannot leak the list to a browser.
 */
/** The host this deployment answers on, from APP_URL — a deployment fact, never a source fact. */
function siteDomain(): string {
  try { return new URL(process.env.APP_URL ?? "http://localhost:4000").host; } catch { return "localhost:4000"; }
}

export const SITE = {
  name: "x",
  domain: siteDomain(),
  /** x is its own identity provider — see app/lib/identity/. Nothing external
   *  signs or verifies a session for it. */
  identityProvider: "self",
};

export type Workspace = { productSlug: string; slug: string; name: string };

/** Workspaces live under a product. Each product ships a "main" workspace. */
export function listWorkspaces(products: Product[]): Workspace[] {
  return products.map((p) => ({ productSlug: p.slug, slug: "main", name: "Main" }));
}

/** Cross-cutting sub-routes every product exposes. */
// The tabs trace the platform's arc: research the idea, build the demo, then take
// it to market. `launch` sits next to `research` because it is downstream of it —
// every claim it can make is one the research already earned.
//
// There is no Team tab. The agent org belongs to the platform and works on every
// product, so the roster is the site's and lives at /about. A product keeps at
// most an agent or two of its own, and a tab that lists one of them is noise.
/**
 * The tabs every product page shows. A tab with `href` leaves the product's
 * own routes (product settings lives under /settings). Workspace and Launch
 * were tabs until 2026-09-26: the generic workspace was an empty state, and
 * the launch surface only means something for a product with a research
 * corpus — a product that wants one adds its own page.
 */
export const PRODUCT_TABS = [
  { key: "", label: "Overview" },
  { key: "research", label: "Research" },
  { key: "roadmap", label: "Roadmap" },
  { key: "wishes", label: "Wishes" },
  { key: "changelog", label: "Changelog" },
  { key: "settings", label: "Product settings", href: (slug: string) => `/settings/products/${slug}`, manageOnly: true },
] as const;
