import { NextResponse, type NextRequest } from "next/server";

import { workerTokenValid } from "@/app/lib/worker";
import { listWorkers, registerWorker } from "@/app/lib/workers";

/**
 * Worker registration and the roster.
 *
 * Liveness is derived from `last_seen_at`, not written by the worker: a crashed
 * process never gets to mark itself offline. Callers treat this as best effort —
 * the claim that actually prevents duplicate work is in the product database.
 */
export async function POST(req: NextRequest) {
  if (!workerTokenValid(req.headers.get("x-worker-token"))) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const id = typeof payload.workerId === "string" ? payload.workerId.trim() : "";
  if (!id || id.length > 128) {
    return NextResponse.json({ error: "workerId required" }, { status: 400 });
  }

  const rawLabel = typeof payload.label === "string" ? payload.label.trim() : "";
  // Bounded: it renders on an admin page and a worker names itself.
  const label = rawLabel ? rawLabel.slice(0, 120) : undefined;

  await registerWorker(id, label);
  return NextResponse.json({ ok: true, workerId: id });
}

/** The roster. Same token — which machines are working is not public. */
export async function GET(req: NextRequest) {
  if (!workerTokenValid(req.headers.get("x-worker-token"))) {
    return NextResponse.json({ error: "not authorised" }, { status: 401 });
  }
  return NextResponse.json({ workers: await listWorkers() });
}
