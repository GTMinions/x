/**
 * selftest-memberships — proves the membership store survives an instance boundary.
 *
 * THE BUG
 * -------
 * Memberships lived in a module-level `Map`. On Vercel a route handler and a page are
 * separate serverless functions, so `POST /api/admin/members` mutated one instance's Map
 * and the `router.refresh()` that followed rendered `/settings/site` in another, whose Map
 * only ever held the code seed. The POST returned `{ok:true}`. The admin never appeared.
 * Nothing threw, so nothing said so.
 *
 * A test that calls setMembership() and then listMembers() in the same process CANNOT see
 * that bug — the Map is right there and everything passes. So the case that matters here is
 * the COLD one: the module is dropped from the require cache and re-evaluated, which gives a
 * fresh empty Map and a fresh empty read-cache, exactly as a second lambda would have. If the
 * admin still comes back, it came back from the store and the write crossed the boundary.
 *
 * The store is now a table in the identity database. This test points it at a
 * throwaway SQLite file, so it touches nothing real — no repo, no Turso.
 *
 * Run: pnpm platform:selftest
 */
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store is `server-only`, and rightly so. The guard stays in the module; it is
// neutralised here, in the harness, rather than weakened there.
const _load = (Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown })._load;
(Module as unknown as { _load: unknown })._load = (req: string, parent: unknown, isMain: boolean) =>
  req === "server-only" ? {} : _load(req, parent, isMain);

// A throwaway database file, deleted at the end. Setting the URL at all is what
// makes `membershipsPersisted()` true — the module treats "no URL" as a local
// file that a second instance would never see, and says so.
import { unlinkSync } from "node:fs";
const DB_FILE = join(tmpdir(), `x-selftest-memberships-${process.pid}.db`);
process.env.ACCOUNTS_DATABASE_URL = `file:${DB_FILE}`;
// The bootstrap admin is a deployment fact read from the environment, so the test
// supplies its own rather than asserting on whoever happens to own production.
const SEED_ADMIN = "bootstrap@example.com";
process.env.SITE_ADMIN_EMAILS = SEED_ADMIN;

const MEM = require.resolve("../app/lib/memberships.ts");
type Store = typeof import("../app/lib/memberships");

/**
 * Re-evaluate the store from scratch — a fresh read-cache and a fresh client,
 * exactly as a second lambda would have. The identity modules go too: leaving
 * them cached would share this process's connection and hide the boundary.
 */
function coldInstance(): Store {
  for (const k of Object.keys(require.cache)) {
    if (k.includes("memberships") || k.includes("identity")) delete require.cache[k];
  }
  return require(MEM) as Store;
}

const results: Array<[boolean, string]> = [];
const check = (ok: boolean, name: string) => results.push([ok, name]);

async function main() {
  const m = coldInstance();
  check(m.membershipsPersisted(), "a configured store reports itself persisted");
  check(m.storeInfo().mode === "db", "storeInfo names the mode the reader is looking at");

  const seeded = await m.listMembers("site", "site");
  check(seeded.length === 1 && seeded[0].email === SEED_ADMIN, "the env seed is present before any write");

  await m.setMembership("newadmin@example.com", "site", "site", "admin");
  const afterGrant = await m.listMembers("site", "site");
  check(afterGrant.some((x) => x.email === "newadmin@example.com" && x.role === "admin"), "a grant is readable straight back");

  // The old store rewrote the whole table as one JSON blob, so a second grant
  // could clobber the first. A keyed upsert cannot — assert both survive.
  await m.setMembership("second@example.com", "site", "site", "editor");
  const both = (await m.listMembers("site", "site")).map((x) => x.email);
  check(
    both.includes("newadmin@example.com") && both.includes("second@example.com"),
    "a second grant does not clobber the first",
  );

  // Re-granting the same person is an update, not a duplicate row.
  await m.setMembership("second@example.com", "site", "site", "admin");
  const reGranted = (await m.listMembers("site", "site")).filter((x) => x.email === "second@example.com");
  check(reGranted.length === 1 && reGranted[0].role === "admin", "re-granting updates the role in place");

  // Scopes must not leak into each other.
  await m.setMembership("prod@example.com", "product", "inference-economics", "reader");
  check(
    (await m.listMembers("product", "inference-economics")).some((x) => x.email === "prod@example.com") &&
      !(await m.listMembers("product", "gtm")).some((x) => x.email === "prod@example.com"),
    "a product grant does not appear on another product",
  );

  // THE ONE THAT MATTERS. Everything above would also pass on the broken in-memory store.
  const cold = coldInstance();
  const admins = (await cold.listMembers("site", "site")).map((a) => a.email);
  check(admins.includes("newadmin@example.com"), "A COLD INSTANCE SEES THE NEW ADMIN — the write crossed the boundary");
  check(admins.includes(SEED_ADMIN), "and the seed is still there");

  let refused = false;
  try {
    await cold.removeMembership(SEED_ADMIN, "site", "site");
  } catch {
    refused = true;
  }
  check(refused, "a bootstrap admin cannot be removed — a bad write cannot lock the platform out");

  // A real removal must reach a cold instance too, or a revoked admin keeps access.
  await cold.setMembership("temp@example.com", "site", "site", "admin");
  await cold.removeMembership("temp@example.com", "site", "site");
  const after = coldInstance();
  check(
    !(await after.listMembers("site", "site")).some((x) => x.email === "temp@example.com"),
    "A COLD INSTANCE SEES THE REVOCATION — revoking is not just a local delete",
  );

  try { unlinkSync(DB_FILE); } catch { /* already gone */ }

  for (const [ok, name] of results) console.log(`   ${ok ? "✓" : "✗"} ${name}`);
  const bad = results.filter(([ok]) => !ok).length;
  if (bad) {
    console.error(`\n✗ selftest-memberships: ${bad}/${results.length} failed.\n`);
    process.exit(1);
  }
  console.log(`\n✓ selftest-memberships: ${results.length}/${results.length} — an added admin survives the instance that added it.\n`);
}

main();
