/**
 * Platform control plane. Workspace section layout, product meta/status, and
 * the typed-export queue are in-memory and reset on cold start. Identity comes
 * from the session (email). Real metering lives in the identity database
 * (`./workers.ts`, `./tiers.ts`) — nothing in this file touches money.
 *
 * Memberships are NOT. They moved to ./memberships, which persists them, because
 * a module-level Map cannot hold them: on Vercel a route handler and a page are
 * separate serverless functions, so `POST /api/admin/members` wrote to one
 * instance's Map and the `router.refresh()` that followed read another's. Adding
 * a site admin returned {ok:true} and changed nothing. Re-exported here so the
 * import surface is unchanged — but every membership call is now ASYNC.
 */
import { getProduct, listProducts, listTeams, PRODUCT_TABS } from "./products";
import { roleAtLeast, type ScopeType } from "./memberships";
import { isSiteAdmin as sessionIsSiteAdmin, type Session } from "./auth";

// ── roles / memberships ─────────────────────────────────────────────────────
export type { Role, ScopeType, Member } from "./memberships";
export {
  roleAt,
  roleAtLeast,
  setMembership,
  removeMembership,
  listMembers,
  onboardToProduct,
  isSiteAdmin,
  membershipsPersisted,
  storeInfo as membershipStoreInfo,
} from "./memberships";

/**
 * May this session open Design Mode on this scope?
 *
 * Two places can make someone an admin, and the toolbar has to honour both: the
 * session JWT (scopes minted at sign-in) and the membership store
 * (grants made at /settings/site and /settings/products). Gating on the JWT alone
 * — which is what every chrome did — meant a site admin added through settings,
 * or any product admin at all, filed wishes from a page they could not annotate.
 *
 * `scope` is a product slug, or "site" for the platform's own pages. A product
 * admin gets the toolbar only inside their product; a site admin gets it anywhere
 * (roleAtLeast already treats a stored site admin as admin of every scope).
 */
export async function canDesign(session: Session | null, scope = "site"): Promise<boolean> {
  if (sessionIsSiteAdmin(session)) return true;
  if (scope !== "site" && session?.scopes?.includes(`admin:${scope}`)) return true;
  if (!session?.email) return false;
  const [t, id]: [ScopeType, string] = scope === "site" ? ["site", "site"] : ["product", scope];
  return roleAtLeast(session.email, t, id, "admin");
}

// ── product meta / status ───────────────────────────────────────────────────
type Meta = { prdUrl?: string; figmaUrl?: string; status: "active" | "frozen" };
const meta = new Map<string, Meta>();
export async function getProductMeta(slug: string): Promise<Meta> {
  const m = meta.get(slug);
  const p = await getProduct(slug);
  return { prdUrl: m?.prdUrl ?? p?.prdUrl ?? "", figmaUrl: m?.figmaUrl ?? p?.figmaUrl ?? "", status: m?.status ?? (p?.status === "frozen" ? "frozen" : "active") };
}
export async function setProductMeta(slug: string, prdUrl: string, figmaUrl: string): Promise<void> {
  meta.set(slug, { ...(await getProductMeta(slug)), prdUrl, figmaUrl });
}
export async function setProductStatus(slug: string, status: "active" | "frozen"): Promise<void> {
  meta.set(slug, { ...(await getProductMeta(slug)), status });
}

// ── workspace section layout ────────────────────────────────────────────────
export type LayoutRow = { key: string; label: string; visible: boolean; position: number };
const layouts = new Map<string, LayoutRow[]>(); // key `${slug}:${ws}`
function catalog(slug: string): { key: string; label: string }[] {
  // generic catalog: a product's cross-cutting tabs are its workspace sections
  return PRODUCT_TABS.filter((t) => t.key && !("href" in t)).map((t) => ({ key: t.key, label: t.label }));
}
export function getWorkspaceLayout(slug: string, ws = "main"): LayoutRow[] {
  const k = `${slug}:${ws}`;
  if (!layouts.has(k)) layouts.set(k, catalog(slug).map((c, i) => ({ ...c, visible: true, position: i })));
  return [...layouts.get(k)!].sort((a, b) => a.position - b.position);
}
export function setSectionVisible(slug: string, sectionKey: string, visible: boolean, ws = "main"): void {
  const rows = getWorkspaceLayout(slug, ws);
  const row = rows.find((r) => r.key === sectionKey);
  if (row) { row.visible = visible; layouts.set(`${slug}:${ws}`, rows); }
}
export function moveSection(slug: string, sectionKey: string, dir: "up" | "down", ws = "main"): void {
  const rows = getWorkspaceLayout(slug, ws);
  const i = rows.findIndex((r) => r.key === sectionKey);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= rows.length) return;
  const pi = rows[i].position; rows[i].position = rows[j].position; rows[j].position = pi;
  layouts.set(`${slug}:${ws}`, rows);
}

// ── typed export queue ──────────────────────────────────────────────────────
export const EXPORT_KINDS = [
  { key: "go", label: "Go implementation" },
  { key: "react-native", label: "React Native app" },
  { key: "flutter", label: "Flutter app" },
  { key: "design-tokens", label: "Design tokens (JSON)" },
  { key: "storybook", label: "Storybook of components" },
] as const;
export type ExportRequest = { id: number; slug: string; kind: string; note: string | null; by: string; at: string; status: "queued" };
let exSeq = 1;
const exportRequests: ExportRequest[] = [];
export function requestExport(slug: string, kind: string, note: string, by: string): ExportRequest {
  const r: ExportRequest = { id: exSeq++, slug, kind, note: note || null, by, at: new Date().toISOString(), status: "queued" };
  exportRequests.push(r);
  return r;
}
export function listExportRequests(slug: string): ExportRequest[] {
  return exportRequests.filter((r) => r.slug === slug).reverse();
}

export { listProducts, listTeams };
