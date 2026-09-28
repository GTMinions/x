/** POST /api/setup/product — an empty product with a database of its own. */
import { NextResponse, type NextRequest } from "next/server";
import { createProduct } from "@/app/lib/provision";
import { guard, fail } from "../_guard";

export async function POST(req: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, string>;
    const r = await createProduct({ slug: String(body.slug ?? ""), name: String(body.name ?? ""), tagline: body.tagline, accent: body.accent });
    return NextResponse.json({ message: `${r.product.name} created at /${r.product.slug}.`, next: r.next });
  } catch (err) {
    return fail(err);
  }
}
