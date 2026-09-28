import { NextResponse, type NextRequest } from "next/server";
import { getWish, wishReceipt } from "@/app/_platform/wishes";

/**
 * GET /api/wishes/<id>/receipt — the wish's timeline, and what the loop recorded
 * spending on it.
 *
 * Readable by anyone who can see the wish, which on x is anyone signed in
 * (proxy.ts gates the whole site). A receipt only the admin who acted on the wish
 * can read would not be a receipt — the person owed it is the one who filed it.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wish = await getWish(Number(id));
  if (!wish) return NextResponse.json({ error: "no such wish" }, { status: 404 });

  const receipt = await wishReceipt(wish);
  return NextResponse.json({ ...receipt, status: wish.status, issueUrl: wish.issueUrl });
}
