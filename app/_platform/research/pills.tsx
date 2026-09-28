/**
 * Prose renderer with `[[slug]]` wikilink resolution.
 *
 * A pill resolves to an internal entity page if the slug exists in the product's
 * content; otherwise it renders as a "dead" pill (dotted) — the same discipline
 * validate-content enforces at build time (pill-resolution-gap should be 0).
 * Also supports a lightweight **bold** and `code` inline.
 */
import React from "react";
import Link from "next/link";
import { t } from "@/app/_platform/copy";


export function ProseWithPills({
  text,
  productSlug,
  slugs,
}: {
  text: string;
  productSlug: string;
  slugs: Set<string>;
}) {
  return (
    <>
      {text.split("\n\n").map((para, i) => (
        <p key={i}>{renderInline(para, productSlug, slugs)}</p>
      ))}
    </>
  );
}

/**
 * Pills, bold and code in ONE pass.
 *
 * This used to split on pills first and run `emphasize` over the gaps. That quietly
 * broke every bold span that *contained* a pill — `**[[mcp]] shipping timeline:**`
 * got cut in half by the pill split, so `emphasize` saw two unbalanced fragments,
 * matched neither, and printed the `**` to the reader. Seven gtm entity summaries
 * shipped with raw asterisks.
 *
 * Tokenising once fixes the class, not the instance: a bold span renders its own
 * inner text through this same function, so nesting works in either direction.
 */
const TOKEN_RE = /(\*\*[\s\S]+?\*\*|`[^`]+`|\[\[[a-z0-9-]+\]\])/g;

export function renderInline(text: string, productSlug: string, slugs: Set<string>): React.ReactNode[] {
  return text.split(TOKEN_RE).filter(Boolean).map((part, i) => {
    const k = `t${i}`;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={k}>{renderInline(part.slice(2, -2), productSlug, slugs)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={k}>{part.slice(1, -1)}</code>;
    const pill = /^\[\[([a-z0-9-]+)\]\]$/.exec(part);
    if (pill) {
      const slug = pill[1];
      return slugs.has(slug) ? (
        <Link key={k} className="wikilink" href={`/${productSlug}/research/${slug}`}>
          {slug}
        </Link>
      ) : (
        <span key={k} className="wikilink dead" title={t("site.platform.research.pills.title-1")}>
          {slug}
        </span>
      );
    }
    return <React.Fragment key={k}>{part}</React.Fragment>;
  });
}

