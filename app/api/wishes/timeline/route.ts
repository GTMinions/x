import { NextResponse, type NextRequest } from "next/server";
import { wishTimeline, wishStore } from "@/app/_platform/wishes";
import { canReadProduct } from "@/app/lib/access";
import { getSession } from "@/app/lib/auth";

/** GET /api/wishes/timeline?scope=<slug> — cumulative shipped-over-time series. */
export async function GET(req: NextRequest) {
  const scope = req.nextUrl.searchParams.get("scope") || "site";
  // Counts are product data too: "37 wishes shipped" tells you a private
  // product exists, is active, and roughly how busy it is.
  if (scope !== "site" && !(await canReadProduct((await getSession())?.email, scope))) {
    return NextResponse.json({ error: `"${scope}" is private.` }, { status: 403 });
  }
  const t = await wishTimeline(scope);
  return NextResponse.json({ store: wishStore(), ...t });
}
