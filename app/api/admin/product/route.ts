import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/app/lib/auth";
import { roleAtLeast, setProductMeta, setProductStatus } from "@/app/lib/platform";

/**
 * POST /api/admin/product — update a product's meta or its status.
 *
 * Wish approval used to be settable here as a per-product "mode". It is not a
 * setting any more: whether a wish waits follows from whether its filer
 * administers the scope (`app/lib/approval.ts`), which is not something a
 * product can opt out of.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const body = await req.json().catch(() => ({}));
  const { slug, kind } = body as { slug: string; kind: "meta" | "status" };
  if (!slug || !kind) return NextResponse.json({ error: "missing fields" }, { status: 400 });

  if (kind === "meta") {
    if (!(await roleAtLeast(session?.email, "product", slug, "editor"))) return NextResponse.json({ error: "editor only" }, { status: 403 });
    await setProductMeta(slug, String(body.prdUrl || ""), String(body.figmaUrl || ""));
  } else if (kind === "status") {
    if (!(await roleAtLeast(session?.email, "product", slug, "admin"))) return NextResponse.json({ error: "admin only" }, { status: 403 });
    await setProductStatus(slug, body.status === "frozen" ? "frozen" : "active");
  } else {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
