/**
 * Memberships — who may administer what, and where that answer is kept.
 *
 * A membership CANNOT live in a module-level Map. On Vercel a route handler and a page
 * are separate serverless functions, so the POST that grants a role and the render that
 * lists roles run in different instances with different memory. That is not a slow leak;
 * it means the grant never happened.
 *
 * WHERE A MEMBERSHIP LIVES
 * A row in x's own identity database (`memberships`), beside `wish_owners` and the
 * encrypted key vault — the other two tables that map an account to a capability.
 *
 * It used to be a GitHub issue labelled `platform-state`, carrying the whole table as
 * JSON in its body. That was durable and cross-instance, and it was also a list of
 * people's EMAIL ADDRESSES in a repository on its way to being public. The store was
 * chosen before the repo's visibility was settled, and stopped making sense the moment
 * it was. `pnpm memberships:import` lifts the old table across.
 *
 * WHY THE IDENTITY DB, GIVEN WHAT THIS FILE USED TO SAY
 * The recorded objection was that `accounts.role` is a login identity shared with
 * anything else pointed at the same database, so writing `admin` there would make an
 * admin of x an admin of everything. That objection is about the COLUMN, and it still
 * stands — nothing here touches `accounts.role`. `memberships` is x's own table, read by
 * nothing else, and a grant in it means nothing outside x.
 *
 * A membership still CANNOT live in a module-level Map: on Vercel a route handler and a
 * page are separate serverless functions, so the POST that grants a role and the render
 * that lists roles run in different instances with different memory. With no
 * ACCOUNTS_DATABASE_URL the database is a local file and has that same problem, which is
 * why `storeInfo()` reports `persisted: false` there rather than pretending.
 */
import "server-only";
import { and, eq } from "drizzle-orm";

import { accountsDbConfigured, db, dbReady } from "./identity/db";
import { memberships } from "./identity/schema";
import { getSetting } from "./settings";

export type Role = "reader" | "editor" | "admin";
export type ScopeType = "site" | "team" | "product" | "workspace";
export type Member = { email: string; role: Role; grantedAt: string };

const RANK: Record<Role, number> = { reader: 1, editor: 2, admin: 3 };
const key = (t: ScopeType, id: string, email: string) => `${t}:${id}:${email.toLowerCase()}`;

// ── the store ────────────────────────────────────────────────────────────────

/**
 * Memberships live in x's own identity database, beside `wish_owners` and the
 * key vault — the other two tables that map an account to a capability.
 *
 * They used to live in a GitHub issue. That was durable and cross-instance and
 * it was also a list of people's email addresses in a repository heading for
 * public. The store was picked before the repo's visibility was settled, and
 * the trade stopped making sense the moment it was.
 *
 * A short cache in front of it is not decoration. `canReadProduct` asks
 * `roleAtLeast` up to twice per product, and the directory asks for every
 * product, so one page render was a dozen round trips without it.
 */
const TTL_MS = 30_000;

let cache: { at: number; rows: Record<string, Member> } | null = null;

/** GitHub's role here is over; the message now comes from the database. Kept
 *  under the same name because `storeInfo()` is rendered on admin surfaces. */
let lastError: string | null = null;

/**
 * Is the store shared across instances?
 *
 * Writes always go to the database — but with no `ACCOUNTS_DATABASE_URL` that
 * database is a local file, and on serverless each instance gets its own copy.
 * A grant would then appear to succeed and be invisible to the next request.
 * That is exactly the bug this module was written to fix, so it is reported
 * rather than hidden: `persisted: false` is the thing the reader needs to know.
 */
export const membershipsPersisted = (): boolean => accountsDbConfigured();

export function storeInfo(): { mode: "db" | "memory"; persisted: boolean; repo: string | null; error: string | null } {
  const persisted = membershipsPersisted();
  return {
    mode: persisted ? "db" : "memory",
    persisted,
    // Kept in the shape for the admin surfaces that render it; a database has
    // no repo, and naming the URL here would print a credential.
    repo: null,
    error: lastError,
  };
}

// ── the seed ─────────────────────────────────────────────────────────────────

/**
 * The bootstrap admins. They are always present, whatever the database says, and
 * they cannot be removed — otherwise a bad write could lock every human out of
 * the platform with no way back in but a redeploy.
 *
 * They come from `SITE_ADMIN_EMAILS` (comma-separated), not from source. A
 * hardcoded address would make anyone who forks and deploys inherit an owner
 * they cannot sign in as — and would publish that address on every clone.
 *
 * Unset → no bootstrap admin, and every admin surface is closed until the
 * deployer sets one. That is the safe failure: a platform nobody can administer
 * beats a platform whose owner is a stranger.
 */
/** Admins saved on /setup (settings key admin.emails), refreshed on every load. */
let savedAdmins: string[] = [];

function bootstrapAdmins(): string[] {
  const env = (process.env.SITE_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...env, ...savedAdmins])];
}

function seed(): Record<string, Member> {
  const out: Record<string, Member> = {};
  for (const email of bootstrapAdmins())
    out[key("site", "site", email)] = { email, role: "admin", grantedAt: "2026-07-01" };
  return out;
}

const isSeed = (k: string) => k in seed();

// ── read / write ─────────────────────────────────────────────────────────────

const ROLES: Role[] = ["reader", "editor", "admin"];
const asRole = (v: unknown): Role => (ROLES.includes(v as Role) ? (v as Role) : "reader");

/**
 * The membership table, seed merged over the top.
 *
 * A failed read falls back to the SEED ALONE, not to a stale cache and not to
 * an empty set that would silently un-admin everybody. Losing granted roles
 * during an outage is a denial of service; keeping them from a cache we cannot
 * refresh would be worse, because a revoked admin would keep their access for
 * as long as the outage lasted.
 */
async function load(): Promise<Record<string, Member>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    await dbReady;
    savedAdmins = (await getSetting("admin.emails", "").catch(() => ""))
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const found = await db.select().from(memberships);
    const rows: Record<string, Member> = { ...seed() };
    for (const r of found) {
      rows[key(r.scopeType as ScopeType, r.scopeId, r.email)] = {
        email: r.email,
        role: asRole(r.role),
        grantedAt: r.grantedAt,
      };
    }
    cache = { at: Date.now(), rows };
    lastError = null;
    return rows;
  } catch (e) {
    lastError = (e as Error).message;
    console.error("[memberships] read failed; falling back to the bootstrap admins only:", lastError);
    return seed();
  }
}

/** Invalidate after a write, so the next read is the truth rather than the
 *  version from up to 30 seconds ago. */
function bust(): void {
  cache = null;
}

/** After /setup saves administrators: the next read sees them at once. */
export function invalidateMemberships(): void {
  bust();
}

// ── the API ──────────────────────────────────────────────────────────────────

export async function roleAt(email: string, t: ScopeType, id: string): Promise<Role | null> {
  return (await load())[key(t, id, email)]?.role ?? null;
}

export async function roleAtLeast(
  email: string | undefined | null,
  t: ScopeType,
  id: string,
  min: Role,
): Promise<boolean> {
  if (!email) return false;
  const rows = await load();
  if (rows[key("site", "site", email)]?.role === "admin") return true; // a site admin may do anything
  const r = rows[key(t, id, email)]?.role;
  return !!r && RANK[r] >= RANK[min];
}

export async function isSiteAdmin(email: string | undefined | null): Promise<boolean> {
  return roleAtLeast(email, "site", "site", "admin");
}

export async function listMembers(t: ScopeType, id: string): Promise<Member[]> {
  const rows = await load();
  return Object.entries(rows)
    .filter(([k]) => k.startsWith(`${t}:${id}:`))
    .map(([, m]) => m)
    .sort((a, b) => RANK[b.role] - RANK[a.role] || a.email.localeCompare(b.email));
}

export async function setMembership(email: string, t: ScopeType, id: string, role: Role): Promise<void> {
  await dbReady;
  const row = {
    scopeType: t,
    scopeId: id,
    email: email.trim().toLowerCase(),
    role,
    grantedAt: new Date().toISOString().slice(0, 10),
  };
  // One row, upserted — not the whole table rewritten. The old store had to
  // read-modify-write a JSON blob, so two admins granting at once lost one of
  // the two grants; a keyed upsert cannot.
  await db
    .insert(memberships)
    .values(row)
    .onConflictDoUpdate({
      target: [memberships.scopeType, memberships.scopeId, memberships.email],
      set: { role: row.role, grantedAt: row.grantedAt },
    });
  bust();
}

export async function removeMembership(email: string, t: ScopeType, id: string): Promise<void> {
  const k = key(t, id, email);
  if (isSeed(k)) throw new Error("that admin is seeded from SITE_ADMIN_EMAILS and cannot be removed here");
  await dbReady;
  await db
    .delete(memberships)
    .where(
      and(
        eq(memberships.scopeType, t),
        eq(memberships.scopeId, id),
        eq(memberships.email, email.trim().toLowerCase()),
      ),
    );
  bust();
}

/** Idempotent first-visit membership; never downgrades. */
export async function onboardToProduct(email: string, slug: string): Promise<void> {
  if (!email) return;
  if (!(await roleAt(email, "product", slug))) await setMembership(email, "product", slug, "reader");
}

