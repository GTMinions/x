/**
 * The build-status light.
 *
 * The one property that matters: **green must mean green.** A status light that
 * turns green because it could not reach anything is worse than no light — it
 * is the exact failure it exists to catch (a failed build, an old instance
 * still serving happily, a site that looks perfect).
 *
 * So every unreachable, slow, malformed or unauthenticated path resolves to
 * `unknown`, and `unknown` renders grey.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV = { ...process.env };

async function load() {
  vi.resetModules();
  return import("../app/lib/deployment");
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_COMMIT_SHA = "aaaaaaa000";
  process.env.VERCEL_GIT_COMMIT_REF = "release";
  delete process.env.NEXT_PUBLIC_COMMIT_REF;
  delete process.env.VERCEL_GIT_COMMIT_SHA;
  delete process.env.VERCEL_TOKEN;
  delete process.env.VERCEL_PROJECT_ID;
  delete process.env.VERCEL_ORG_ID;
});

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

const reply = (body: unknown, ok = true, status = 200) =>
  vi.fn(async () => ({ ok, status, json: async () => body }) as unknown as Response);

describe("what version is running", () => {
  it("reports the build's own commit, short", async () => {
    const { runningVersion } = await load();
    expect(runningVersion).toBe("aaaaaaa");
  });

  it("prefers the host's stamp when there is one", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "bbbbbbb111";
    const { runningVersion } = await load();
    expect(runningVersion).toBe("bbbbbbb");
  });
});

describe("which branch is running", () => {
  it("reports the branch the build came from", async () => {
    const { runningBranch } = await load();
    expect(runningBranch).toBe("release");
  });

  it("says `local` off a host rather than guessing a branch name", async () => {
    // Naming a branch nobody deployed from is worse than admitting there is
    // no deployment — `main` would read as "this is the integration build".
    delete process.env.VERCEL_GIT_COMMIT_REF;
    const { runningBranch } = await load();
    expect(runningBranch).toBe("local");
  });

  it("carries the branch on every status, credential or not", async () => {
    const { deployStatus } = await load();
    expect((await deployStatus()).branch).toBe("release");
  });
});

describe("green means green", () => {
  it("says UNKNOWN, not live, when no token is configured", async () => {
    const { deployStatus } = await load();
    const s = await deployStatus();
    expect(s.state).toBe("unknown");
    expect(s.why).toMatch(/VERCEL_TOKEN/);
    // The version is still useful and still correct without any credential.
    expect(s.version).toBe("aaaaaaa");
  });

  it("says UNKNOWN when the API refuses", async () => {
    process.env.VERCEL_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "p";
    vi.stubGlobal("fetch", reply({}, false, 403));
    const { deployStatus } = await load();
    expect((await deployStatus()).state).toBe("unknown");
  });

  it("says UNKNOWN when the API cannot be reached at all", async () => {
    process.env.VERCEL_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "p";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    const { deployStatus } = await load();
    const s = await deployStatus();
    expect(s.state).toBe("unknown");
    expect(s.why).toMatch(/could not reach/);
  });
});

describe("the three colours", () => {
  const withApi = async (readyState: string, sha = "aaaaaaa000") => {
    process.env.VERCEL_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "p";
    vi.stubGlobal("fetch", reply({ deployments: [{ readyState, meta: { githubCommitSha: sha } }] }));
    const { deployStatus } = await load();
    return deployStatus();
  };

  it("READY on my own commit is live", async () => {
    expect((await withApi("READY")).state).toBe("live");
  });

  it("BUILDING and QUEUED are both building — one light, one meaning", async () => {
    expect((await withApi("BUILDING")).state).toBe("building");
    expect((await withApi("QUEUED")).state).toBe("building");
  });

  it("ERROR and CANCELED are both failed", async () => {
    expect((await withApi("ERROR")).state).toBe("failed");
    expect((await withApi("CANCELED")).state).toBe("failed");
  });

  it("CATCHES THE STATE THE LIGHT EXISTS FOR — newest failed, I keep serving", async () => {
    const s = await withApi("ERROR", "ffffff999");
    expect(s.state).toBe("failed");
    // Names the build that failed, so the tooltip can say which one.
    expect(s.latest).toBe("ffffff9");
  });

  it("READY on somebody else's commit is STALE, not live", async () => {
    // A newer build is live and this instance is a leftover. Painting that
    // green would say "you are looking at the newest code" when you are not.
    const s = await withApi("READY", "ccccccc222");
    expect(s.state).toBe("stale");
    expect(s.latest).toBe("ccccccc");
  });

  it("carries the inspector URL straight from the API, never assembled", async () => {
    process.env.VERCEL_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "p";
    vi.stubGlobal("fetch", reply({ deployments: [{
      readyState: "ERROR",
      inspectorUrl: "https://vercel.com/team/proj/DEPLOYID",
      meta: { githubCommitSha: "ffffff999" },
    }] }));
    const { deployStatus } = await load();
    const s = await deployStatus();
    // Points at the build that FAILED, not at the one still serving — that is
    // the one somebody clicking a red light needs to read.
    expect(s.inspectorUrl).toBe("https://vercel.com/team/proj/DEPLOYID");
    expect(s.latest).toBe("ffffff9");
  });

  it("omits the URL entirely when the API did not give one", async () => {
    // Rather than guessing a dashboard path: a link that lands on an index is
    // worse than plain text at the moment a build broke.
    process.env.VERCEL_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "p";
    vi.stubGlobal("fetch", reply({ deployments: [{ readyState: "READY", meta: { githubCommitSha: "aaaaaaa000" } }] }));
    const { deployStatus } = await load();
    expect((await deployStatus()).inspectorUrl).toBeUndefined();
  });

  it("does not invent a colour for a state it does not know", async () => {
    expect((await withApi("SOMETHING_NEW")).state).toBe("unknown");
  });
});

describe("main is not behind release — it is beside it", () => {
  // The API query is `target=production`, so a preview off `main` is always
  // being compared against a build from `release`. Two shas with no branches
  // beside them read as "you are behind" when the truth is the opposite.
  const onBranch = async (mine: string, theirs: string, myShaSuffix = "000") => {
    process.env.VERCEL_GIT_COMMIT_REF = mine;
    process.env.VERCEL_GIT_COMMIT_SHA = `aaaaaaa${myShaSuffix}`;
    process.env.VERCEL_TOKEN = "t";
    process.env.VERCEL_PROJECT_ID = "p";
    vi.stubGlobal("fetch", reply({ deployments: [{
      readyState: "READY",
      meta: { githubCommitSha: "ccccccc222", githubCommitRef: theirs },
    }] }));
    const { deployStatus } = await load();
    return deployStatus();
  };

  it("DOES NOT call a preview stale just because production is a different sha", async () => {
    const s = await onBranch("main", "release");
    expect(s.state).not.toBe("stale");
    expect(s.branch).toBe("main");
  });

  it("names production's branch so the arrow is not read as `you are behind`", async () => {
    const s = await onBranch("main", "release");
    expect(s.latestBranch).toBe("release");
    expect(s.latest).toBe("ccccccc");
  });

  it("still calls it stale when it IS the same branch — the real leftover case", async () => {
    const s = await onBranch("release", "release");
    expect(s.state).toBe("stale");
    // Same line of work, so there is no other branch worth naming.
    expect(s.latestBranch).toBeUndefined();
  });
});
