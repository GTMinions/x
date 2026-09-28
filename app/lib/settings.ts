import "server-only";

/**
 * Site settings that an admin can change at runtime, in the identity database.
 *
 * WHY NOT A MODULE-LEVEL MAP
 * This project has already paid for that mistake once. Memberships lived in a
 * `Map`, and on serverless a route handler and a page are separate functions:
 * `POST` mutated one instance's Map, the `router.refresh()` that followed
 * rendered in another, and adding a site admin returned `{ok:true}` and changed
 * nothing. Nothing threw, so nothing said so. A setting that decides whether
 * real cards get charged must not be able to fail that way — so it is a row,
 * read by whoever is serving the request.
 *
 * WHY NOT AN ENVIRONMENT VARIABLE
 * `STRIPE_MODE=live` would work and would be simpler, but changing it means a
 * redeploy. The point of the toggle is to flip between the sandbox and the real
 * thing while looking at the page, and to flip *back* the moment something
 * looks wrong. A setting you have to redeploy to change is one you will not
 * reach for in the minute you need it.
 *
 * Cached for a few seconds because a page render asks more than once, and this
 * is a single row that changes about twice a year. The TTL is the honest cost:
 * an admin flipping the switch may see the old value for a moment.
 */

import { eq } from "drizzle-orm";

import { db, dbReady } from "./identity/db";
import { siteSettings } from "./identity/schema";

const TTL_MS = 5_000;

let cache: { at: number; rows: Record<string, string> } | null = null;

async function load(): Promise<Record<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  await dbReady;
  try {
    const rows = await db.select().from(siteSettings);
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    cache = { at: Date.now(), rows: out };
    return out;
  } catch (err) {
    // A settings table that cannot be read must not take the site down. Every
    // caller has a default, and the defaults are the safe end of each switch —
    // `stripeMode` defaults to `test`, so an unreachable database bills nobody.
    console.error("[settings] could not read site settings; using defaults", err);
    return cache?.rows ?? {};
  }
}

export async function getSetting(key: string, fallback: string): Promise<string> {
  const rows = await load();
  return rows[key] ?? fallback;
}

/**
 * Drop this module instance's cache. The dev server compiles a page and an API
 * route as separate module graphs, so the cache a route busted on write is not
 * the cache the page reads from; a page that must show a save at once calls
 * this first (the setup page does).
 */
export function refreshSettings(): void {
  cache = null;
}

export async function setSetting(key: string, value: string, byWhom: string): Promise<void> {
  await dbReady;
  await db
    .insert(siteSettings)
    .values({ key, value, updatedAt: Math.floor(Date.now() / 1000), updatedBy: byWhom })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: { value, updatedAt: Math.floor(Date.now() / 1000), updatedBy: byWhom },
    });
  cache = null; // the writer, at least, sees it immediately
}

/** Who last changed a setting, and when. Rendered beside the switch: a control
 *  that decides whether money moves should say who moved it last. */
export async function settingMeta(key: string): Promise<{ updatedAt: number; updatedBy: string } | null> {
  await dbReady;
  const rows = await db.select().from(siteSettings).where(eq(siteSettings.key, key)).limit(1);
  const r = rows[0];
  return r ? { updatedAt: r.updatedAt, updatedBy: r.updatedBy ?? "unknown" } : null;
}

/**
 * The paywall switch.
 *
 * ON (the default): a wish needs a tier, and a tier needs a checkout — even the
 * free one, which is a $0 subscription so that every account passes through the
 * same door and arrives with a card on file.
 *
 * OFF: nobody is asked to subscribe and every account files freely. This is the
 * internal deployment — a team running the platform for itself, where a
 * checkout in front of your own colleagues is ceremony.
 *
 * Default ON, and read with the safe fallback: an unreachable settings table
 * leaves the wall standing rather than quietly opening it. A gate that fails
 * open is not a gate.
 */
export const PAYWALL_KEY = "paywall.enabled";

export async function paywallOn(): Promise<boolean> {
  return (await getSetting(PAYWALL_KEY, "on")) !== "off";
}

export async function setPaywall(on: boolean, byWhom: string): Promise<void> {
  await setSetting(PAYWALL_KEY, on ? "on" : "off", byWhom);
}
