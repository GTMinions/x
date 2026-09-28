/**
 * Where x can run, and where its data can live — as a table, not a script.
 *
 * Two independent choices. A HOST is where the site runs; a DATABASE is where
 * the registry and every product's data live. Each provider names the keys it
 * needs in the environment before anything else can happen — the bootstrap
 * keys — and where a person gets them. Everything a provider does not list here
 * is collected on /setup and stored in the site database (app/lib/onboarding.ts).
 *
 * The rule the whole onboarding follows: the credential that reaches the host
 * and the credential that reaches the first database live in the environment;
 * nothing else has to.
 *
 * install.sh asks the same two questions in the same order. A contributor
 * adding a host or a database adds an entry here, an adapter (app/lib/turso.ts
 * is the shape), and the matching branch in install.sh.
 *
 * Plain module: read by the setup page, the API, and scripts.
 */

export type ProviderKey = {
  name: string;
  /** Required before the site can do anything with this provider. */
  required: boolean;
  /** Where a person gets the value, in one line. */
  where: string;
};

export type Provider = {
  id: string;
  name: string;
  /** One sentence, for the question a person answers. */
  blurb: string;
  keys: ProviderKey[];
};

export const HOSTS: Provider[] = [
  {
    id: "computer",
    name: "This computer",
    blurb: "Runs on the machine you are sitting at. The owner is signed in automatically while the address is localhost.",
    keys: [],
  },
  {
    id: "vercel",
    name: "Vercel",
    blurb: "Hosted; serverless, so data must live in a hosted database.",
    keys: [
      { name: "VERCEL_TOKEN", required: true, where: "vercel.com → Account → Tokens. Lets the site store its own variables and redeploy itself." },
      { name: "VERCEL_PROJECT_ID", required: false, where: "Project → Settings → General. Found automatically when not set." },
      { name: "VERCEL_ORG_ID", required: false, where: "The team id, for a project under a team." },
    ],
  },
];

export const DATABASES: Provider[] = [
  {
    id: "sqlite",
    name: "SQLite files on this computer",
    blurb: "One file per product under .local-db/. No account, nothing to set up. Only for a site that runs on one machine.",
    keys: [],
  },
  {
    id: "turso",
    name: "Turso",
    blurb: "Hosted databases, one per product, created on first use. Free tier is plenty to start.",
    keys: [
      { name: "TURSO_API_TOKEN", required: true, where: "app.turso.tech → Settings → API tokens." },
      { name: "TURSO_ORG", required: true, where: "Your organisation slug, top-left in the Turso dashboard." },
      { name: "TURSO_GROUP", required: false, where: "The group (region) new databases go in. Defaults to 'default'." },
    ],
  },
];

/** Combinations that cannot work, with the reason a person should read. */
export const IMPOSSIBLE: { host: string; database: string; why: string }[] = [
  { host: "vercel", database: "sqlite", why: "Vercel functions have no disk that survives a request, so a file database would be a new empty file every time." },
];

export function hostById(id: string): Provider | undefined {
  return HOSTS.find((h) => h.id === id);
}
export function databaseById(id: string): Provider | undefined {
  return DATABASES.find((d) => d.id === id);
}

/** Where this process is running, from the environment it finds itself in. */
export function detectHost(): "vercel" | "computer" {
  return process.env.VERCEL ? "vercel" : "computer";
}

/**
 * Where the data lives. `named` means an operator pointed PRODUCT_DB_SITE_URL
 * at a database outright — any libsql server — and the provider table stays
 * out of it.
 */
export function detectDatabase(): "turso" | "sqlite" | "named" {
  if (process.env.PRODUCT_DB_SITE_URL) return "named";
  if (process.env.TURSO_API_TOKEN?.trim() && process.env.TURSO_ORG?.trim()) return "turso";
  return "sqlite";
}

export function keyPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/** The keys of a provider that are required and missing. */
export function missingKeys(p: Provider): ProviderKey[] {
  return p.keys.filter((k) => k.required && !keyPresent(k.name));
}
