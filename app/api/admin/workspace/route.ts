import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/app/lib/auth";
import { roleAtLeast, setSectionVisible, moveSection } from "@/app/lib/platform";

/** POST /api/admin/workspace — toggle/reorder a workspace section. Editor+. */
export async function POST(req: NextRequest) {
  const session = await getSession();
  const body = await req.json().catch(() => ({}));
  const { slug, kind, sectionKey } = body as { slug: string; kind: "toggle" | "move"; sectionKey: string };
  if (!slug || !kind || !sectionKey) return NextResponse.json({ error: "missing fields" }, { status: 400 });
  if (!(await roleAtLeast(session?.email, "product", slug, "editor"))) return NextResponse.json({ error: "editor only" }, { status: 403 });
  if (kind === "toggle") setSectionVisible(slug, sectionKey, !!body.visible);
  else moveSection(slug, sectionKey, body.dir === "up" ? "up" : "down");
  return NextResponse.json({ ok: true });
}
