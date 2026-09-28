import type { NextConfig } from "next";
import { execSync } from "node:child_process";

/** The running build's identity, for the operator dock.
 *  Vercel sets VERCEL_GIT_COMMIT_SHA itself; locally we ask git, so a dev
 *  server shows the commit it is actually running rather than "dev". */
function commitSha(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}


const config: NextConfig = {
  // No backend required to run. The token wallet, workspace layout and export queue are
  // in-memory and reset on cold start. Memberships are not: they persist to the same
  // GitHub-issue store the wishlist uses (app/lib/memberships.ts), because a module-level
  // Map cannot outlive the serverless function that holds it.
  reactStrictMode: true,
  // The research engine reads each product's content/*.json at request/build time,
  // and /about reads the agent, skill, and memory markdown out of the .claude
  // folders — the platform's at the root, plus whatever a product keeps of its own.
  // All of it is read with fs at request time, so all of it ships in the traced bundle.
  outputFileTracingIncludes: {
    "/**": [
      "./app/**/*.json",
      "./app/(products)/*/.claude/**/*.md",
      "./.claude/agents/*.md",
      "./.claude/skills/**/*.md",
      "./.claude/memory/*.md",
      "./content/**/*",
      // The demo product bundle that /setup loads into a database of its own.
      "./demo/*.json",
      "./public/**/*",
      // A wish's receipt names the run that worked it, which it can only do by
      // reading the loop's own logs. Untraced, they exist in dev and vanish in
      // the serverless bundle — and the receipt would quietly report that no run
      // ever touched the wish. That failure looks exactly like the truth.
      "./cronjobs/logs/*.json",
    ],
  },
  env: { BUILD_TIME: new Date().toISOString(), NEXT_PUBLIC_COMMIT_SHA: commitSha() },
  async redirects() {
    return [
      // Landing convenience: the flagship demo product.
      { source: "/demo", destination: "/inference-economics", permanent: false },
    ];
  },
};

export default config;
