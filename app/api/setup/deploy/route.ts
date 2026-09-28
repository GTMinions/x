/** POST /api/setup/deploy — a production deployment, so the next build pulls every product. */
import { NextResponse } from "next/server";
import { redeploy } from "@/app/lib/vercel";
import { guard, fail } from "../_guard";

export async function POST() {
  const denied = await guard();
  if (denied) return denied;
  try {
    const d = await redeploy();
    return NextResponse.json({ message: "Deployment started.", next: { kind: "redeployed", url: d.url } });
  } catch (err) {
    return fail(err);
  }
}
