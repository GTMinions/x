/**
 * tiers — read and write what this deployment sells.
 *
 * The numbers live in the `tiers` table, not in this repository, so a clone
 * sells nothing until `set` is run against its own database.
 *
 *   pnpm tiers
 *   pnpm tiers set plus --name Plus --price 499 --per-day 3 --rank 2
 *   pnpm tiers unlist pro
 *
 * Raw SQL, like `product-db.ts`: the typed helpers are `server-only`.
 */
import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function loadEnv(): void {
  for (const name of [".env.local", ".env.production.local"]) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m || process.env[m[1]!]) continue;
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
}

/** `ACCOUNTS_DATABASE_URL` if named, else the local file. No auto-provisioning:
 *  a read command should not create somebody's production database. */
function identityDb(): Client {
  const url = process.env.ACCOUNTS_DATABASE_URL?.trim();
  if (url) return createClient({ url, authToken: process.env.ACCOUNTS_DATABASE_AUTH_TOKEN });
  const local = path.join(ROOT, "identity.db");
  if (!fs.existsSync(local)) {
    throw new Error(
      "No identity database. Set ACCOUNTS_DATABASE_URL, or start the app once so the local file is created.",
    );
  }
  return createClient({ url: `file:${local}` });
}

const DDL = `CREATE TABLE IF NOT EXISTS tiers (
   id            TEXT PRIMARY KEY,
   name          TEXT NOT NULL,
   price_cents   INTEGER NOT NULL DEFAULT 0,
   per_day       INTEGER,
   per_month     INTEGER,
   rank          INTEGER NOT NULL DEFAULT 0,
   requires_card INTEGER NOT NULL DEFAULT 1,
   blurb         TEXT NOT NULL DEFAULT '',
   listed        INTEGER NOT NULL DEFAULT 1,
   stripe_price_test TEXT,
   stripe_price_live TEXT,
   updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
   updated_by    TEXT
 )`;

/** Columns added after the table first shipped. `CREATE TABLE IF NOT EXISTS`
 *  does not add them to a database that already has the table, so an existing
 *  deployment needs this the way the app's own schema does. */
const ADDITIONS: [string, string][] = [
  ["stripe_price_test", "TEXT"],
  ["stripe_price_live", "TEXT"],
];

async function migrate(db: Client): Promise<void> {
  await db.execute(DDL);
  const cols = new Set(
    (await db.execute("PRAGMA table_info(tiers)")).rows.map((r) => String((r as unknown as { name: unknown }).name)),
  );
  for (const [name, ddl] of ADDITIONS) {
    if (!cols.has(name)) await db.execute(`ALTER TABLE tiers ADD COLUMN ${name} ${ddl}`);
  }
}

type Row = {
  id: string; name: string; price_cents: number;
  per_day: number | null; per_month: number | null;
  rank: number; requires_card: number; blurb: string; listed: number;
  stripe_price_test: string | null; stripe_price_live: string | null;
};

const argv = process.argv.slice(2);
const has = (name: string) => argv.includes(`--${name}`);
const flag = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const num = (name: string): number | null => {
  const v = flag(name);
  if (v === null || v === "null") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} wants a number (or "null" to clear it)`);
  return n;
};
const money = (c: number) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

async function rows(db: Client): Promise<Row[]> {
  const res = await db.execute("SELECT * FROM tiers ORDER BY rank DESC");
  return res.rows as unknown as Row[];
}

async function show(db: Client): Promise<void> {
  const all = await rows(db);
  if (!all.length) {
    console.log("\nNo tiers configured — this deployment sells nothing.\n");
    console.log("Every account is on one unpriced tier with no guarantee, and the queue uses");
    console.log("the board's own order. That is the correct state for a fresh clone: the code");
    console.log("knows how a guarantee behaves and knows no prices at all.\n");
    console.log("  pnpm tiers set free --name Free --price 0   --per-month 1 --rank 1");
    console.log("  pnpm tiers set plus --name Plus --price 499 --per-day 3   --rank 2\n");
    return;
  }
  console.log(`\n${"id".padEnd(10)}${"name".padEnd(12)}${"price".padEnd(9)}${"guarantee".padEnd(22)}${"rank".padEnd(6)}${"listed".padEnd(8)}price id`);
  for (const t of all) {
    const g =
      [t.per_day !== null ? `${t.per_day}/day` : null, t.per_month !== null ? `${t.per_month}/month` : null]
        .filter(Boolean)
        .join(" · ") || "none";
    console.log(
      t.id.padEnd(10) + t.name.padEnd(12) + money(t.price_cents).padEnd(9) +
        g.padEnd(22) + String(t.rank).padEnd(6) + (t.listed ? "yes" : "no").padEnd(8) +
        // Shown for a $0 tier too: a free tier that still runs through checkout
        // needs a price like any other, and hiding the column made a missing one
        // look deliberate.
        ((t.stripe_price_test ? "test ✓" : "test —") + (t.stripe_price_live ? " live ✓" : " live —")),
    );
  }

  // price ÷ guarantee, the figure that decides which tier breaks first.
  const paid = all.filter((t) => t.price_cents > 0 && t.per_day !== null);
  if (paid.length > 1) {
    console.log("\nprice per guaranteed wish (a month at the daily rate):");
    for (const t of paid) {
      const per = t.price_cents / 100 / (t.per_day! * 30);
      console.log(`  ${t.id.padEnd(10)} $${per.toFixed(4)}`);
    }
    console.log("  A wish costs the same to build whoever files it, so the lowest figure here is");
    console.log("  the tier that turns unprofitable first — and at a lower utilisation than the rest.");
  }
  console.log();
}

async function set(db: Client, id: string, byWhom: string): Promise<void> {
  await migrate(db);
  const cur = (await rows(db)).find((t) => t.id === id);

  // Merged onto the existing row so one field can change on its own.
  const next = {
    id,
    name: flag("name") ?? cur?.name ?? id,
    price_cents: has("price") ? Math.max(0, Math.trunc(num("price") ?? 0)) : (cur?.price_cents ?? 0),
    per_day: has("per-day") ? num("per-day") : (cur?.per_day ?? null),
    per_month: has("per-month") ? num("per-month") : (cur?.per_month ?? null),
    rank: has("rank") ? Math.trunc(num("rank") ?? 0) : (cur?.rank ?? 0),
    requires_card: has("no-card") ? 0 : (cur?.requires_card ?? 1),
    blurb: flag("blurb") ?? cur?.blurb ?? "",
    listed: has("unlist") ? 0 : has("list") ? 1 : (cur?.listed ?? 1),
    stripe_price_test: has("price-test") ? flag("price-test") : (cur?.stripe_price_test ?? null),
    stripe_price_live: has("price-live") ? flag("price-live") : (cur?.stripe_price_live ?? null),
  };

  await db.execute({
    sql: `INSERT INTO tiers (id, name, price_cents, per_day, per_month, rank, requires_card, blurb, listed,
                             stripe_price_test, stripe_price_live, updated_at, updated_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), ?)
          ON CONFLICT(id) DO UPDATE SET
            name=excluded.name, price_cents=excluded.price_cents, per_day=excluded.per_day,
            per_month=excluded.per_month, rank=excluded.rank, requires_card=excluded.requires_card,
            blurb=excluded.blurb, listed=excluded.listed,
            stripe_price_test=excluded.stripe_price_test, stripe_price_live=excluded.stripe_price_live,
            updated_at=unixepoch(), updated_by=excluded.updated_by`,
    args: [next.id, next.name, next.price_cents, next.per_day, next.per_month, next.rank,
           next.requires_card, next.blurb, next.listed,
           next.stripe_price_test, next.stripe_price_live, byWhom],
  });
  console.log(`${cur ? "Updated" : "Created"} tier "${id}".`);
  await show(db);
}

/**
 * Put an account on a tier by hand.
 *
 * The webhook is the writer when payments are configured; this is the writer
 * when they are not — an internal deployment has no checkout, and without this
 * no account could ever hold a paid tier's guarantee. Also how an operator
 * comps somebody. Works through the same column the webhook writes.
 */
async function grant(db: Client, email: string, tierId: string): Promise<void> {
  await migrate(db);
  const known = (await rows(db)).some((t) => t.id === tierId);
  if (!known && tierId !== "free") {
    throw new Error(`No tier "${tierId}" — create it first: pnpm tiers set ${tierId} …`);
  }
  const found = await db.execute({
    sql: "SELECT account_id FROM account_emails WHERE email = ?",
    args: [email.trim().toLowerCase()],
  });
  const accountId = (found.rows[0] as unknown as { account_id?: number } | undefined)?.account_id;
  if (!accountId) throw new Error(`No account with the address ${email}. They need to sign in once first.`);

  await db.execute({ sql: "INSERT INTO account_usage (account_id) VALUES (?) ON CONFLICT DO NOTHING", args: [accountId] });
  await db.execute({
    sql: "UPDATE account_usage SET tier = ?, updated_at = unixepoch() WHERE account_id = ?",
    args: [tierId, accountId],
  });
  console.log(`${email} → ${tierId}`);
}

async function main(): Promise<void> {
  loadEnv();
  const cmd = argv[0];
  const who = process.env.USER ?? "cli";

  if (cmd === "comp" || cmd === "uncomp") {
    const [, email, ...rest] = argv;
    if (!email) throw new Error(`${cmd} wants an email: pnpm tiers ${cmd} them@example.com`);
    const db = identityDb();
    await db.execute(`CREATE TABLE IF NOT EXISTS comps (email TEXT PRIMARY KEY, note TEXT, granted_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
    const e = email.trim().toLowerCase();
    if (cmd === "uncomp") {
      await db.execute({ sql: "DELETE FROM comps WHERE email = ?", args: [e] });
      console.log(`${e} removed from the guest list`);
    } else {
      await db.execute({
        sql: "INSERT INTO comps (email, note, granted_by) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET note=excluded.note",
        args: [e, rest.join(" ") || null, who],
      });
      console.log(`${e} comped — no paywall, and their wishes are built first`);
    }
    const rows = await db.execute("SELECT email, note FROM comps ORDER BY created_at DESC");
    for (const r of rows.rows) console.log(`  ${r.email}${r.note ? "  — " + r.note : ""}`);
    return;
  }

  if (cmd === "grant") {
    const [, email, tierId] = argv;
    if (!email || !tierId) throw new Error("grant wants: pnpm tiers grant <email> <tier-id>");
    return grant(identityDb(), email, tierId);
  }

  if (cmd && !["list", "set", "unlist", "list-again", "comp", "uncomp"].includes(cmd)) {
    console.log(
      "pnpm tiers [list]\n" +
        "       pnpm tiers set <id> [--name N] [--price CENTS] [--per-day N|null] [--per-month N|null]\n" +
        "                           [--rank N] [--blurb T] [--no-card] [--unlist|--list]\n" +
        "                           [--price-test price_xxx] [--price-live price_xxx]\n" +
        "       pnpm tiers unlist <id>\n" +
        "       pnpm tiers grant <email> <tier-id>   (manual tier assignment)\n" +
        "       pnpm tiers comp <email> [why]        (guest list: no paywall, built first)\n" +
        "       pnpm tiers uncomp <email>",
    );
    process.exit(1);
  }

  const db = identityDb();
  await migrate(db);

  if (!cmd || cmd === "list") return show(db);
  const id = argv[1];
  if (!id || id.startsWith("--")) throw new Error(`${cmd} wants a tier id`);
  if (cmd === "unlist") argv.push("--unlist");
  return set(db, id, who);
}

main().then(() => process.exit(0), (err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
