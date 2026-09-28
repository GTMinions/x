import type { Metadata } from "next";
import "./globals.css";
import { t, CopyScope } from "@/app/_platform/copy";
import { SITE_CLIENT_COPY_PREFIXES } from "@/app/_platform/copy/site-scopes";
import { RegistryProvider } from "@/app/_platform/registry-client";
import { listProductSlugs } from "@/app/lib/registry";

export const metadata: Metadata = {
  title: t("site.home.layout.title-1"),
  description: t("site.home.layout.description-1"),
};

/**
 * `AdminBar` is gone: the payment-mode chip is the leftmost segment of `SiteDock`, which
 * mounts inside `SiteChrome` where the rest of the site chrome already lives. Keeping it
 * here meant the strip also appeared on product pages, stacked under the product's own
 * floating toolbars, which is how four objects came to share one corner.
 */
/**
 * Two things every page gets from here: the platform's client copy (the chrome,
 * the dock and Design Mode read their words through useCopy()) and the list of
 * product slugs, so a client component can tell a product path from a platform
 * one without a database of its own.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const slugs = await listProductSlugs();
  return (
    <html lang="en">
      <body>
        <RegistryProvider slugs={slugs}>
          <CopyScope prefix={SITE_CLIENT_COPY_PREFIXES}>{children}</CopyScope>
        </RegistryProvider>
      </body>
    </html>
  );
}
