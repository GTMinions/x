import { NextResponse, type NextRequest } from "next/server";
import { gzipSync } from "node:zlib";
import { getProduct } from "@/app/lib/products";
import { loadEntities, loadEdges, buildTopology } from "@/app/_platform/research/engine";
import { listWishes } from "@/app/_platform/wishes";
import { getSession } from "@/app/lib/auth";
import { roleAtLeast, getProductMeta } from "@/app/lib/platform";
import { canReadProduct } from "@/app/lib/access";

/**
 * GET /api/products/<slug>/export?format=json|standalone
 *   json       → a single JSON manifest (config + research + wishes).
 *   standalone → a .tar.gz bundle: manifest + README + the research content as
 *                a content/ tree (portable, dependency-free archive).
 * Requires product reader+.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) return NextResponse.json({ error: "no such product" }, { status: 404 });

  const session = await getSession();
  if (!(await canReadProduct(session?.email, slug))) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }

  const entities = product.hasResearch ? loadEntities(slug) : [];
  const edges = product.hasResearch ? loadEdges(slug) : [];
  const manifest = {
    exportedAt: new Date().toISOString(),
    product: { ...product, ...(await getProductMeta(slug)) },
    research: product.hasResearch ? { entities, edges, topology: buildTopology(slug) } : null,
    wishes: await listWishes(slug),
  };

  const format = req.nextUrl.searchParams.get("format") || "json";
  if (format === "json") {
    return new NextResponse(JSON.stringify(manifest, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${slug}-export.json"` },
    });
  }

  // standalone → tar.gz bundle
  const files: Record<string, string> = {
    "manifest.json": JSON.stringify(manifest, null, 2),
    "README.md": `# ${product.name} — export\n\nGenerated ${manifest.exportedAt}.\n\n- \`manifest.json\` — full product snapshot (config, research, wishes)\n- \`content/entities/*.json\` — research entities on the depth ladder\n- \`content/edges.json\` — typed cross-links\n- \`content/wishes.json\` — the wishlist\n`,
    "content/edges.json": JSON.stringify({ edges }, null, 2),
    "content/wishes.json": JSON.stringify(manifest.wishes, null, 2),
  };
  for (const e of entities) files[`content/entities/${e.slug}.json`] = JSON.stringify(e, null, 2);

  const archive = tarGz(`${slug}/`, files);
  return new NextResponse(new Uint8Array(archive), {
    headers: { "content-type": "application/gzip", "content-disposition": `attachment; filename="${slug}.tar.gz"` },
  });
}

// ── tiny dependency-free tar + gzip writer ──────────────────────────────────
function octal(n: number, len: number): string {
  return n.toString(8).padStart(len - 1, "0") + "\0";
}
function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write(octal(0o644, 8), 100);
  h.write(octal(0, 8), 108);
  h.write(octal(0, 8), 116);
  h.write(octal(size, 12), 124);
  h.write(octal(Math.floor(Date.now() / 1000), 12), 136);
  h.write("        ", 148); // checksum placeholder (spaces)
  h.write("0", 156);        // type: normal file
  h.write("ustar\0", 257);
  h.write("00", 263);
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(octal(sum, 8), 148);
  return h;
}
function tarGz(root: string, files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) {
    const bytes = Buffer.from(content, "utf8");
    parts.push(tarHeader(root + path, bytes.length));
    parts.push(bytes);
    const pad = (512 - (bytes.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024)); // two zero blocks = end of archive
  return gzipSync(Buffer.concat(parts));
}
