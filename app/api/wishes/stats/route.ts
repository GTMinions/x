import { NextResponse, type NextRequest } from "next/server";
import { wishStats } from "@/app/_platform/wishes";
import { canReadProduct } from "@/app/lib/access";
import { getSession } from "@/app/lib/auth";

/**
 * GET /api/wishes/stats?scope=<slug> — shipped-wish counts by builder role for
 * the viber bar. Falls back to the Referer's first path segment (so the bar can
 * fetch without a param), then to "site".
 */
export async function GET(req: NextRequest) {
  let scope = req.nextUrl.searchParams.get("scope") || "";
  if (!scope) {
    const referer = req.headers.get("referer");
    if (referer) {
      try {
        scope = new URL(referer).pathname.split("/").filter(Boolean)[0] || "site";
      } catch {
        scope = "site";
      }
    } else {
      scope = "site";
    }
  }
  // Counts are product data too: "37 wishes shipped" tells you a private
  // product exists, is active, and roughly how busy it is.
  if (scope !== "site" && !(await canReadProduct((await getSession())?.email, scope))) {
    return NextResponse.json({ error: `"${scope}" is private.` }, { status: 403 });
  }
  return NextResponse.json(await wishStats(scope));
}
