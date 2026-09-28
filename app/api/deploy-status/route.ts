import { NextResponse } from "next/server";

/**
 * GET /api/deploy-status — a traffic-light for the top bar. Degrades gracefully:
 * off-Vercel → green "local"; on Vercel (if you can load this, the build
 * finished) → green "live". Never cries wolf. Returns { light, label, sha, ref, built }.
 */
export async function GET() {
  const onVercel = !!process.env.VERCEL;
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  const ref = process.env.VERCEL_GIT_COMMIT_REF ?? null;
  const built = process.env.BUILD_TIME ?? null;
  return NextResponse.json({
    light: "green",
    label: onVercel ? "live" : "local",
    state: "READY",
    sha, ref, built,
  });
}
