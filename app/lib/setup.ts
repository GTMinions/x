/**
 * First-run setup — what the site needs, in the order it needs it, and what
 * it has so far. /setup renders this.
 *
 * Two kinds of thing. The HOST and DATABASE keys live in the environment,
 * because they are what the site needs before it can reach anything
 * (app/lib/providers.ts names them). Everything else — who the administrator
 * is, how sign-in codes are mailed, Google sign-in — is collected on the page
 * and kept in the site's own settings table (app/lib/onboarding.ts), so a
 * person answers those questions in a form, not in a dashboard.
 *
 * No value is ever shown, only whether a name is set.
 */
import "server-only";
import { registryMode } from "./registry/core";
import { listProducts, type Product } from "./registry";
import { accountsDbConfigured } from "./identity/db";
import { onVercel, vercelConfigured } from "./vercel";
import { DATABASES, HOSTS, detectDatabase, detectHost, keyPresent, missingKeys, type Provider } from "./providers";
import { adminEmails, googleConfig, localSingleUserRequest, mailConfig } from "./onboarding";
import { refreshSettings } from "./settings";
import { t } from "@/app/_platform/copy";

export const DEMO_SLUG = "inference-economics";

export type SetupKey = { name: string; present: boolean; required: boolean; where: string };
export type SetupStep = {
  id: "host" | "database" | "owner" | "signin" | "products";
  title: string;
  why: string;
  /** Where the answer goes, in one line. */
  source: string;
  keys: SetupKey[];
  optional: boolean;
  done: boolean;
};

/** A value's origin, for the form to say "set in the environment" instead of showing a blank field. */
export type Origin = "env" | "settings" | "none";

export type SetupStatus = {
  onVercel: boolean;
  host: { id: string; name: string };
  database: { id: string; name: string };
  steps: SetupStep[];
  /** Every required step is done. */
  ready: boolean;
  products: Product[];
  demoSlug: string;
  demoLoaded: boolean;
  canProvision: boolean;
  canRedeploy: boolean;
  /** hosted (Turso) or local (SQLite files) — see app/lib/registry/core.ts. */
  mode: "fixture" | "named" | "hosted" | "local";
  /** The request came from localhost on a computer-hosted site: the owner is signed in without an account. */
  localSingleUser: boolean;
  /** No administrator anywhere yet. */
  firstRun: boolean;
  admins: { count: number; origin: Origin };
  mail: { origin: Origin; host: string; user: string; from: string; port: string };
  google: { origin: Origin; clientId: string };
};

const keysOf = (p: Provider): SetupKey[] => p.keys.map((k) => ({ name: k.name, present: keyPresent(k.name), required: k.required, where: k.where }));

export async function setupStatus(): Promise<SetupStatus> {
  refreshSettings(); // a save on this page must show on the next load, not five seconds later
  const vercel = onVercel();
  const hostId = detectHost();
  const dbId = detectDatabase();
  const host = HOSTS.find((h) => h.id === hostId)!;
  const database = DATABASES.find((d) => d.id === dbId) ?? { id: "named", name: t("site.lib.setup.named-db"), blurb: "", keys: [] };
  const [products, admins, mail, google, local] = await Promise.all([
    listProducts(),
    adminEmails(),
    mailConfig(),
    googleConfig(),
    localSingleUserRequest(),
  ]);

  const envAdmins = Boolean(process.env.SITE_ADMIN_EMAILS?.trim());
  const envMail = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const envGoogle = Boolean(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID);
  const signInReady = Boolean(mail) || Boolean(google.clientId && google.clientSecret);

  // On a computer the accounts database is a file; on Vercel it must be hosted,
  // which Turso gives automatically and a named database must be paired with.
  const identityOk = !vercel || accountsDbConfigured() || dbId === "turso";

  const steps: SetupStep[] = [
    {
      id: "host",
      title: t("site.lib.setup.host-title", { host: host.name }),
      why: host.blurb,
      source: hostId === "vercel" ? t("site.lib.setup.host-source-vercel") : t("site.lib.setup.host-source-computer"),
      keys: keysOf(host),
      optional: false,
      done: hostId === "computer" || vercelConfigured(),
    },
    {
      id: "database",
      title: t("site.lib.setup.db-title", { database: database.name }),
      why: dbId === "sqlite" && vercel ? t("site.lib.setup.db-why-impossible") : database.blurb,
      source: dbId === "turso" ? t("site.lib.setup.db-source-turso") : dbId === "named" ? t("site.lib.setup.db-source-named") : t("site.lib.setup.db-source-sqlite"),
      keys: keysOf(database),
      optional: false,
      done: !(dbId === "sqlite" && vercel) && missingKeys(database).length === 0 && identityOk,
    },
    {
      id: "owner",
      title: t("site.lib.setup.owner-title"),
      why: local ? t("site.lib.setup.owner-why-local") : t("site.lib.setup.owner-why"),
      source: t("site.lib.setup.owner-source"),
      keys: [],
      optional: false,
      done: admins.length > 0,
    },
    {
      id: "signin",
      title: t("site.lib.setup.signin-title"),
      why: vercel ? t("site.lib.setup.signin-why-hosted") : t("site.lib.setup.signin-why-local"),
      source: t("site.lib.setup.signin-source"),
      keys: [],
      optional: !vercel,
      done: signInReady,
    },
    {
      id: "products",
      title: t("site.lib.setup.title-6"),
      why: t("site.lib.setup.why-11"),
      source: t("site.lib.setup.source-17"),
      keys: [],
      optional: false,
      done: products.length > 0,
    },
  ];

  return {
    onVercel: vercel,
    host: { id: host.id, name: host.name },
    database: { id: database.id, name: database.name },
    steps,
    ready: steps.filter((s) => !s.optional).every((s) => s.done),
    products,
    demoSlug: DEMO_SLUG,
    demoLoaded: products.some((p) => p.slug === DEMO_SLUG),
    canProvision: true,
    mode: registryMode(),
    canRedeploy: vercelConfigured(),
    localSingleUser: local,
    firstRun: admins.length === 0,
    admins: { count: admins.length, origin: envAdmins ? "env" : admins.length ? "settings" : "none" },
    mail: mail
      ? { origin: envMail ? "env" : "settings", host: mail.host, user: mail.user, from: mail.from, port: String(mail.port) }
      : { origin: "none", host: "", user: "", from: "", port: "" },
    google: { origin: google.clientId ? (envGoogle ? "env" : "settings") : "none", clientId: google.clientId },
  };
}
