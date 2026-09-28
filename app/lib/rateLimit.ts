import "server-only";

/**
 * A small fixed-window rate limiter.
 *
 * WHAT THIS IS HONEST ABOUT
 * The counters live in module memory, so on serverless each instance keeps its
 * own. Under fan-out the effective ceiling is `limit × instances`, not `limit`.
 * That is a real weakness and it is stated here rather than discovered later:
 * this raises the cost of abuse, it does not make abuse impossible. A precise
 * limit needs a shared store (Redis / Turso), and the seam for that is the
 * single `hit()` function below.
 *
 * It still earns its place. The endpoint it protects — requesting a sign-in
 * code — sends mail to an address the caller names, which makes an unlimited
 * version a way to use this deployment to bother a stranger. A per-instance cap
 * turns "unbounded" into "bounded and slow", which is the difference that
 * matters.
 *
 * Vercel's own Firewall / BotID sit in front of this and should carry the bulk
 * of the load in production; this is the floor that holds when they are not
 * configured, including for anyone self-hosting.
 */

type Window = { count: number; resetAt: number };

const buckets = new Map<string, Window>();

/** Bound the map so a flood of distinct keys cannot grow it without limit. */
const MAX_KEYS = 10_000;

function sweep(now: number): void {
  for (const [k, w] of buckets) if (w.resetAt <= now) buckets.delete(k);
  if (buckets.size > MAX_KEYS) {
    // Oldest-first eviction. Losing a counter fails open for that key, which is
    // the right trade against refusing service to everyone.
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [k] of sorted.slice(0, buckets.size - MAX_KEYS)) buckets.delete(k);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Requests left in this window. */
  remaining: number;
  /** Seconds until the window resets — the value for `Retry-After`. */
  retryAfter: number;
}

/**
 * Count one request against `key`.
 *
 * @param key      Bucket identity — namespace it, e.g. `otp:ip:1.2.3.4`.
 * @param limit    Requests allowed per window.
 * @param windowMs Window length in milliseconds.
 */
export function hit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const w = buckets.get(key);
  if (!w || w.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfter: 0 };
  }

  w.count += 1;
  const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  if (w.count > limit) return { ok: false, remaining: 0, retryAfter };
  return { ok: true, remaining: limit - w.count, retryAfter };
}

/**
 * Best-effort client address.
 *
 * `x-forwarded-for` is caller-supplied and trivially spoofed in general — but
 * behind a proxy that overwrites it (Vercel does) the FIRST entry is the real
 * peer. Self-hosting behind something that does not overwrite it means this
 * degrades to a hint. It is not an identity; it is a bucket key.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Count a *quantity* against `key`, not a request.
 *
 * `hit` answers "how many times", which is the wrong question for anything
 * whose cost varies. Twenty uploads is meaningless; twenty MEGABYTES is the
 * thing that fills a database. So attachments spend a byte budget rather than
 * a call budget, and one big file costs what ten small ones would.
 *
 * Note it checks BEFORE spending: a request that would overshoot is refused
 * and charged nothing, so a single oversized item cannot exhaust a window it
 * was never allowed to use.
 */
export function spend(key: string, cost: number, budget: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const w = buckets.get(key);
  if (!w || w.resetAt <= now) {
    if (cost > budget) return { ok: false, remaining: budget, retryAfter: Math.ceil(windowMs / 1000) };
    buckets.set(key, { count: cost, resetAt: now + windowMs });
    return { ok: true, remaining: budget - cost, retryAfter: 0 };
  }

  const retryAfter = Math.max(1, Math.ceil((w.resetAt - now) / 1000));
  if (w.count + cost > budget) return { ok: false, remaining: Math.max(0, budget - w.count), retryAfter };

  w.count += cost;
  return { ok: true, remaining: budget - w.count, retryAfter };
}
