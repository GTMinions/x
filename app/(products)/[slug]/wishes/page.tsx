/** Generic wishlist. */
import { notFound } from "next/navigation";
import { getProduct } from "@/app/lib/registry";
import { ProductShell } from "@/app/_platform/ProductShell";
import { WishBoard } from "@/app/_platform/WishBoard";
import { ProductUsage } from "@/app/_platform/wishes/ProductUsage";

export default async function GenericWishes({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!(await getProduct(slug))) notFound();
  return (
    <ProductShell slug={slug} active="wishes">
      <ProductUsage scope={slug} />
      <WishBoard scope={slug} />
    </ProductShell>
  );
}
