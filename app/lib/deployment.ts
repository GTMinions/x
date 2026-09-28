import "server-only";

/**
 * What version is running, and is a newer one in trouble.
 *
 * ── TWO FACTS, TWO SOURCES, VERY DIFFERENT RELIABILITY ──────────────────────
 * The running instance knows its OWN version for free: the build stamps the
 * commit into the bundle. That is always available, needs no credential, and
 * cannot be wrong — it is the code answering "which code am I".
 *
 * Whether a NEWER deployment is building or has failed is a question only the
 * host can answer, because a failed build never runs and therefore never gets
 * to tell you it failed. That needs an API token, and everything about it is
 * optional: with no token the dock shows the version and no light, which is
 * honest. A status light that goes green because it could not reach anything
 * is worse than no light.
 *
 * ── WHY NOT JUST TRUST "I AM SERVING, SO I AM FINE" ─────────────────────────
 * That is exactly the state this is meant to catch. You push, the build fails,
 * and the old instance keeps serving happily — the site looks perfect and your
 * change is nowhere. Green has to mean "the newest build is the one you are
 * looking at", not "something is up".
 */

/** The running build, stamped at build time. `dev` when there is no build. */
export const runningVersion: string =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.NEXT_PUBLIC_COMMIT_SHA?.slice(0, 7) ??
  "dev";

/**
 * Which branch this build came from. `main` integrates and `release` deploys,
 * so a sha alone does not say whether you are looking at a preview or at
 * production — and those are exactly the two an operator confuses.
 */
export const runningBranch: string =
  process.env.VERCEL_GIT_COMMIT_REF?.trim() ||
  process.env.NEXT_PUBLIC_COMMIT_REF?.trim() ||
  "local";

export type DeployState = "live" | "building" | "failed" | "stale" | "unknown";

export type DeployStatus = {
  /** Which build is answering this request. */
  version: string;
  /** The branch that build came from — `local` off a host. */
  branch: string;
  state: DeployState;
  /** The newest deployment's version, when it differs from the running one. */
  latest?: string;
  /**
   * The newest PRODUCTION deployment's branch. Named separately because it is
   * often not `branch`: a preview off `main` is compared against production,
   * which comes from `release`, and a sha pair with no branches beside it
   * reads as "you are behind" when the truth is "you are ahead, elsewhere".
   */
  latestBranch?: string;
  /**
   * Vercel's own inspector page for the NEWEST deployment — build log, source,
   * the error if it failed. Taken from the API rather than assembled from ids:
   * a hand-built dashboard URL is a guess about somebody else's routing, and
   * the one moment this link matters is the moment a build broke.
   *
   * It points at `latest`, which is `version` only when the state is `live`.
   * On `failed` and `stale` the link deliberately goes to the OTHER build —
   * the one that needs looking at — which is why the tooltip names which.
   */
  inspectorUrl?: string;
  /** Why the state is `unknown` — shown as a tooltip, never as a green light. */
  why?: string;
};

/** Vercel's deployment states, mapped to the three colours a person can act on. */
function mapState(readyState: string): Exclude<DeployState, "stale" | "unknown"> | null {
  switch (readyState) {
    case "READY":
      return "live";
    case "BUILDING":
    case "QUEUED":
    case "INITIALIZING":
      return "building";
    case "ERROR":
    case "CANCELED":
      return "failed";
    default:
      return null;
  }
}

let cache: { at: number; status: DeployStatus } | null = null;
const TTL_MS = 20_000;

/**
 * The newest production deployment, as a colour.
 *
 * Cached for twenty seconds: the dock renders on every page an admin opens, and
 * the interesting window (did my push land?) is minutes long, not milliseconds.
 */
export async function deployStatus(): Promise<DeployStatus> {
  const version = runningVersion;
  const branch = runningBranch;

  if (cache && Date.now() - cache.at < TTL_MS) return cache.status;

  const token = process.env.VERCEL_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) {
    // Not an error: a deployment that never configured this simply shows its
    // version. Say which piece is missing so it is fixable, not mysterious.
    return { version, branch, state: "unknown", why: "set VERCEL_TOKEN and VERCEL_PROJECT_ID to see build status" };
  }

  const team = process.env.VERCEL_ORG_ID?.trim();
  const url =
    `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}` +
    `&target=production&limit=1` +
    (team ? `&teamId=${encodeURIComponent(team)}` : "");

  try {
    // Bounded: this runs inside a page render, and a hanging status light must
    // not hold the page open.
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const status: DeployStatus = { version, branch, state: "unknown", why: `Vercel API ${res.status}` };
      cache = { at: Date.now(), status };
      return status;
    }

    const body = (await res.json()) as {
      deployments?: { readyState?: string; state?: string; inspectorUrl?: string; meta?: Record<string, string> }[];
    };
    const newest = body.deployments?.[0];
    const mapped = newest ? mapState(String(newest.readyState ?? newest.state ?? "")) : null;
    const latest = newest?.meta?.githubCommitSha?.slice(0, 7);
    const latestBranch = newest?.meta?.githubCommitRef;

    // The query is `target=production`, so `latest` is always production's.
    // A preview off `main` is therefore being compared against a build from
    // `release` — a different line of work, not a newer version of this one.
    const sameLine = !latestBranch || latestBranch === branch;

    let state: DeployState = mapped ?? "unknown";
    // Newest is live but it is not me: this instance is a leftover from before
    // the last deploy. Rare, and worth saying rather than painting green.
    if (mapped === "live" && latest && version !== "dev" && latest !== version && sameLine) state = "stale";

    const status: DeployStatus = {
      version,
      branch,
      state,
      ...(newest?.inspectorUrl ? { inspectorUrl: newest.inspectorUrl } : {}),
      ...(latest && latest !== version ? { latest } : {}),
      ...(latestBranch && !sameLine ? { latestBranch } : {}),
      ...(state === "unknown" && !mapped ? { why: "unrecognised deployment state" } : {}),
    };
    cache = { at: Date.now(), status };
    return status;
  } catch (err) {
    const status: DeployStatus = {
      version,
      branch,
      state: "unknown",
      why: (err as Error)?.name === "TimeoutError" ? "Vercel API timed out" : "could not reach the Vercel API",
    };
    cache = { at: Date.now(), status };
    return status;
  }
}
