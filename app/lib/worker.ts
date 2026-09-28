import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Compare a caller-supplied token against `WISH_WORKER_TOKEN`.
 *
 * The worker that builds wishes reaches the platform over the network like
 * anything else, and `/api/internal/*` is what it is allowed to call. Today
 * that is one route: reporting what a run spent, so the tokens land on the
 * account that filed the wish.
 *
 * Constant-time, so the comparison does not leak the token a byte at a time.
 * An unset variable refuses everything — a deployment with no worker cannot be
 * talked into accepting one.
 */
export function workerTokenValid(supplied: string | null | undefined): boolean {
  const expected = process.env.WISH_WORKER_TOKEN;
  if (!expected || !supplied) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
