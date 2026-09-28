/** Generic research index for a product without pages of its own. */
import { notFound } from "next/navigation";
import { getProduct } from "@/app/lib/registry";
import { ProductShell } from "@/app/_platform/ProductShell";
import { ResearchIndex } from "@/app/_platform/research/ResearchIndex";
import { T } from "@/app/_platform/copy";

export default async function GenericResearch({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  return (
    <ProductShell slug={slug} active="research">
      <div className="eyebrow"><T id="site.products.slug.research.div-1" /></div>
      <h1 style={{ marginTop: 8 }}>{product.name}</h1>
      <p className="muted" style={{ maxWidth: 620, marginTop: 8, fontSize: 15 }}>
        <T id="site.products.slug.research.p-1" />
      </p>
      <div style={{ marginTop: 28 }}><ResearchIndex productSlug={slug} /></div>
    </ProductShell>
  );
}
