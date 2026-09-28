/**
 * Dump every database to a local folder.
 *
 *   pnpm db:backup                  all of them, into ./backups/<timestamp>/
 *   pnpm db:backup --out /path      somewhere else
 *   pnpm db:backup --check          verify the newest backup, restore nothing
 *
 * WHY THIS EXISTS
 * The platform's data is spread across one identity database and one per
 * product. Between them they hold every account, every membership, the JWT
 * signing key, users' encrypted API keys, every wish and the whole research
 * corpus. Turso keeps its own point-in-time recovery, and that is a fine floor
 * — but it is the same account and the same credential as the thing being
 * protected. A backup you cannot reach after losing your Turso token is not a
 * backup of the case you are most afraid of.
 *
 * So this writes plain SQL to disk, readable by any sqlite3, restorable without
 * this repository existing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * Upload anywhere. A script that ships your accounts table to an object store
 * needs another credential, and that credential is then in the same
 * `.env.local` as everything else it is meant to survive. Point this at a synced
 * folder, or pipe the directory somewhere yourself — the choice of where a copy
 * of every user's data lives is not one a script should make quietly.
 *
 * WHAT A BACKUP OF THIS DATA IS
 * Personal data: email addresses, sign-in records, who filed which wish, and
 * what every account has spent. Treat the output directory as you would the
 * databases: encrypted disk, not a shared drive, not a repo.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";

const ROOT = process.cwd();

function loadEnvLocal(): void {
  for (const name of [".env.local", ".env.production.local"]) {
    const f = path.join(ROOT, name);
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const [, k, raw] = m;
      if (process.env[k]) continue;
      process.env[k] = raw!.replace(/^["']|["']$/g, "");
    }
  }
}
loadEnvLocal();

// ── what there is to back up ────────────────────────────────────────────────

type Target = { name: string; url: string; token?: string };

/** Discovered from the environment, not from a hardcoded list: a product added
 *  tomorrow is backed up tomorrow, with nobody remembering to edit this file. */
function targets(): Target[] {
  const out: Target[] = [];

  const identity = process.env.ACCOUNTS_DATABASE_URL;
  if (identity) {
    out.push({ name: "identity", url: identity, token: process.env.ACCOUNTS_DATABASE_AUTH_TOKEN });
  }

  for (const key of Object.keys(process.env)) {
    const m = /^PRODUCT_DB_(.+)_URL$/.exec(key);
    if (!m || !process.env[key]) continue;
    const slug = m[1]!.toLowerCase().replace(/_/g, "-");
    out.push({
      name: `product-${slug}`,
      url: process.env[key]!,
      token: process.env[`PRODUCT_DB_${m[1]}_TOKEN`],
    });
  }
  return out;
}

// ── dumping ─────────────────────────────────────────────────────────────────

/**
 * Dump one database as SQL.
 *
 * `turso db shell <url> .dump` is the fast path and produces a file sqlite3 can
 * restore directly. When the CLI is absent or unauthenticated — CI, someone
 * else's machine — fall back to reading the schema and rows over libsql and
 * writing the same SQL by hand. Slower, and it means a backup never silently
 * depends on a tool being installed.
 */
async function dump(t: Target): Promise<string> {
  if (t.url.startsWith("file:")) return dumpViaClient(t);
  try {
    return execFileSync("turso", ["db", "shell", t.url, ".dump"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return dumpViaClient(t);
  }
}

const q = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return String(v);
  if (v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    const b = Buffer.from(v as ArrayBuffer);
    return `X'${b.toString("hex")}'`;
  }
  return `'${String(v).replace(/'/g, "''")}'`;
};

async function dumpViaClient(t: Target): Promise<string> {
  const db: Client = createClient({ url: t.url, authToken: t.token });
  const out: string[] = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];

  const objects = await db.execute(
    "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END",
  );

  for (const row of objects.rows) {
    const sql = String(row.sql);
    out.push(`${sql};`);
    if (String(row.type) !== "table") continue;

    const table = String(row.name);
    const rows = await db.execute(`SELECT * FROM "${table}"`);
    if (!rows.rows.length) continue;
    const cols = rows.columns.map((c) => `"${c}"`).join(", ");
    for (const r of rows.rows) {
      const vals = rows.columns.map((c) => q((r as Record<string, unknown>)[c])).join(", ");
      out.push(`INSERT INTO "${table}" (${cols}) VALUES (${vals});`);
    }
  }

  out.push("COMMIT;");
  db.close();
  return out.join("\n") + "\n";
}

// ── verification ────────────────────────────────────────────────────────────

/**
 * A dump nobody has restored is a hypothesis.
 *
 * This replays the SQL into a scratch database and counts the rows back, which
 * catches the failures that matter: a truncated file, an unescaped value, a
 * dump that ran against an empty database because a credential had expired.
 */
function verify(file: string): { ok: boolean; tables: number; rows: number; error?: string } {
  const scratch = `${file}.verify.db`;
  try {
    fs.rmSync(scratch, { force: true });
    execFileSync("sqlite3", [scratch], { input: fs.readFileSync(file, "utf8"), stdio: ["pipe", "pipe", "pipe"] });
    const count = execFileSync(
      "sqlite3",
      [scratch, "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"],
      { encoding: "utf8" },
    ).trim();
    const tables = Number(count) || 0;
    let rows = 0;
    if (tables) {
      const names = execFileSync(
        "sqlite3",
        [scratch, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"],
        { encoding: "utf8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      for (const n of names) {
        rows += Number(execFileSync("sqlite3", [scratch, `SELECT count(*) FROM "${n}"`], { encoding: "utf8" }).trim()) || 0;
      }
    }
    return { ok: tables > 0, tables, rows };
  } catch (e) {
    return { ok: false, tables: 0, rows: 0, error: (e as Error).message.split("\n")[0] };
  } finally {
    fs.rmSync(scratch, { force: true });
  }
}

const human = (n: number) => (n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`);

// ── run ─────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const outFlag = argv.indexOf("--out");
  const baseDir = outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1]! : path.join(ROOT, "backups");

  if (argv.includes("--check")) return check(baseDir);

  const list = targets();
  if (!list.length) {
    console.error("Nothing to back up: no ACCOUNTS_DATABASE_URL and no PRODUCT_DB_*_URL is set.");
    return 1;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(baseDir, stamp);
  fs.mkdirSync(dir, { recursive: true });

  console.log(`Backing up ${list.length} database(s) → ${path.relative(ROOT, dir) || dir}\n`);

  let failed = 0;
  const manifest: Record<string, unknown>[] = [];

  for (const t of list) {
    const file = path.join(dir, `${t.name}.sql`);
    try {
      const sql = await dump(t);
      fs.writeFileSync(file, sql);
      const size = fs.statSync(file).size;
      const v = verify(file);
      const mark = v.ok ? "✓" : "✗";
      console.log(
        `  ${mark} ${t.name.padEnd(22)} ${human(size).padStart(9)}  ` +
          (v.ok ? `${v.tables} tables · ${v.rows} rows` : `UNRESTORABLE — ${v.error ?? "no tables"}`),
      );
      if (!v.ok) failed++;
      manifest.push({ name: t.name, file: path.basename(file), bytes: size, ...v });
    } catch (e) {
      console.error(`  ✗ ${t.name.padEnd(22)} ${(e as Error).message.split("\n")[0]}`);
      failed++;
      manifest.push({ name: t.name, error: (e as Error).message });
    }
  }

  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({ at: new Date().toISOString(), databases: manifest }, null, 2),
  );

  console.log(
    `\n${failed ? `✗ ${failed} of ${list.length} failed.` : `✓ ${list.length} database(s) dumped and verified restorable.`}`,
  );
  console.log(`\nThis directory holds personal data and encrypted API keys. Keep it where you`);
  console.log(`would keep the databases themselves — and off any shared drive.`);
  console.log(`\nRestore one with:  sqlite3 restored.db < ${path.join(path.relative(ROOT, dir) || dir, "identity.sql")}`);
  return failed ? 1 : 0;
}

/** Re-verify the newest backup without taking a new one. Cheap enough to run
 *  from a cron and notice that last night's dump is a zero-byte file. */
function check(baseDir: string): number {
  if (!fs.existsSync(baseDir)) {
    console.error(`No backups at ${baseDir}. Run \`pnpm db:backup\` first.`);
    return 1;
  }
  const runs = fs.readdirSync(baseDir).filter((d) => fs.statSync(path.join(baseDir, d)).isDirectory()).sort();
  const latest = runs[runs.length - 1];
  if (!latest) {
    console.error(`No backups at ${baseDir}.`);
    return 1;
  }
  const dir = path.join(baseDir, latest);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql"));
  console.log(`Checking ${latest} — ${files.length} dump(s)\n`);

  const ageHours = (Date.now() - fs.statSync(dir).mtimeMs) / 3_600_000;
  let bad = 0;
  for (const f of files) {
    const v = verify(path.join(dir, f));
    console.log(`  ${v.ok ? "✓" : "✗"} ${f.padEnd(26)} ${v.ok ? `${v.tables} tables · ${v.rows} rows` : v.error ?? "no tables"}`);
    if (!v.ok) bad++;
  }
  if (ageHours > 48) console.warn(`\n! the newest backup is ${Math.floor(ageHours / 24)} days old`);
  console.log(bad ? `\n✗ ${bad} unrestorable.` : `\n✓ all restorable.`);
  return bad ? 1 : 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
