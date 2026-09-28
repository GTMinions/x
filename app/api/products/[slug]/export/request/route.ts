import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/app/lib/auth";
import { roleAtLeast, requestExport } from "@/app/lib/platform";
import { canReadProduct } from "@/app/lib/access";

/** POST /api/products/<slug>/export/request — queue a typed export (Go/RN/…). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await getSession();
  // One policy, one place: a public demo is exportable by anyone signed in,
  // a private product needs a grant. Requiring a membership even on the public
  // demo would have made "readable" and "exportable" two different rules.
  if (!(await canReadProduct(session?.email, slug))) return NextResponse.json({ error: "not allowed" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.kind) return NextResponse.json({ error: "kind required" }, { status: 400 });
  const r = requestExport(slug, String(body.kind), String(body.note || ""), session?.email ?? "guest");
  return NextResponse.json({ ok: true, request: r }, { status: 201 });
}
