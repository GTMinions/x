import { NextResponse } from "next/server";
import { publicJwks } from "@/app/lib/identity/keys";

/**
 * GET /.well-known/jwks.json — the public half of the signing key.
 *
 * x used to *read* this endpoint from a separate accounts service. It publishes its own
 * now, which is what makes the deployment a complete identity provider rather
 * than a client of one: the proxy verifies sessions against this URL, and any
 * other service that wants to trust an x-issued token can too.
 *
 * Public by construction — a JWKS is meant to be world-readable, and the route
 * is on the proxy's public list for that reason. Only `publicJwk` is serialised;
 * the private PEM never leaves the server.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jwks = await publicJwks();
    return NextResponse.json(jwks, {
      headers: { "cache-control": "public, max-age=300, stale-while-revalidate=600" },
    });
  } catch (e) {
    console.error("[identity] could not publish JWKS:", e);
    return NextResponse.json({ keys: [] }, { status: 503 });
  }
}
