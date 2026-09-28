/** POST /api/setup/demo — load the demo product from demo/<slug>.json into a database of its own. */
import { NextResponse } from "next/server";
import { loadDemoProduct } from "@/app/lib/provision";
import { guard, fail } from "../_guard";

export async function POST() {
  const denied = await guard();
  if (denied) return denied;
  try {
    const r = await loadDemoProduct();
    const c = r.counts;
    return NextResponse.json({
      message: `${r.product.name} loaded: ${c.entities} entities, ${c.substrates} substrates, ${c.documents} documents, ${c.product_files} data modules, ${c.ui_copy} copy rows.`,
      next: r.next,
    });
  } catch (err) {
    return fail(err);
  }
}
