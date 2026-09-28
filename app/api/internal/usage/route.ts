import { NextResponse, type NextRequest } from "next/server";

import { getDbWish } from "@/app/_platform/wishes/db";
import { workerTokenValid } from "@/app/lib/worker";
import { ownerOf } from "@/app/lib/wishOwners";
import { recordFulfilment } from "@/app/lib/tiers";
import { recordSpend } from "@/app/lib/workers";

/**
 * The worker reports what a run cost, when a wish ships.
 *
 * Takes a wish, not an account: the wish→account join happens here so a caller
 * can only bill work it just did. Authenticated with WISH_WORKER_TOKEN; unset
 * refuses everything.
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

  const wishId = Number(payload.wishId);
  if (!Number.isInteger(wishId) || wishId <= 0) {
    return NextResponse.json({ error: "wishId required" }, { status: 400 });
  }

  const idempotencyKey = typeof payload.idempotencyKey === "string" ? payload.idempotencyKey.trim() : "";
  if (!idempotencyKey) {
    // Required, not defaulted — a key generated here would differ per request,
    // which is the opposite of what makes a retry safe.
    // which is exactly backwards: the point is that a RETRY carries the same one.
    return NextResponse.json({ error: "idempotencyKey required" }, { status: 400 });
  }

  const count = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
  const input = count(payload.inputTokens);
  const cacheRead = count(payload.cacheReadTokens);
  const cacheWrite = count(payload.cacheWriteTokens);
  const output = count(payload.outputTokens);

  // A split child has no owner row of its own — ownership was recorded when
  // the PARENT was filed, and the children were minted by the CLI, which cannot
  // reach the identity database. Splitting changes how the work arrives, not
  // whose work it is, so the bill and the fulfilment follow the parent's filer.
  // Without this, `--split` would be the way to build for free.
  let owner = await ownerOf(wishId);
  if (!owner && typeof payload.scope === "string") {
    const wish = await getDbWish(payload.scope, wishId);
    if (wish?.parentId) owner = await ownerOf(wish.parentId);
  }
  if (!owner) {
    // Filed before ownership was tracked. Not an error — nobody to charge.
    return NextResponse.json({ ok: true, recorded: false, why: `wish #${wishId} has no recorded filer` });
  }

  // Before the token check and independent of it: the wish was built either
  // way, and skipping it would make "no token report" a way to build for free.
  await recordFulfilment(owner.accountId, wishId);

  // A run that recorded nothing charges nothing.
  if (input + cacheRead + cacheWrite + output === 0) {
    return NextResponse.json({ ok: true, recorded: false, why: "the run recorded no token count" });
  }

  const { recorded } = await recordSpend({
    accountId: owner.accountId,
    wishId,
    scope: typeof payload.scope === "string" ? payload.scope : null,
    workerId: typeof payload.workerId === "string" ? payload.workerId : null,
    model: typeof payload.model === "string" ? payload.model : null,
    inputTokens: input,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    outputTokens: output,
    idempotencyKey,
  });

  return recorded
    ? NextResponse.json({ ok: true, recorded: true, tokens: input + cacheRead + cacheWrite + output })
    : NextResponse.json({ ok: true, recorded: false, why: "already recorded" });
}
