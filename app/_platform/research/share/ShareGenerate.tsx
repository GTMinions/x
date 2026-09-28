"use client";

/**
 * ShareGenerate — "turn this topic into a post."
 *
 * The button on every research topic page that asks for a shareable topic
 * (wish #14). It does not render cards in the browser: a share topic is corpus
 * content, written by the loop under the product's `content/sharing/` with the
 * `xiaohongshu-post` skill and the product's own content doctrine, then reviewed
 * by the critics like any other reader-visible artifact. What one click can do
 * honestly is FILE THE ASK — so, like SectionDive one column over, it files a
 * wish scoped to this product and entity and hands back the receipt: a wish
 * number you can open, not a word that says a wish exists somewhere.
 */
import React from "react";
import Link from "next/link";
import { useCopy } from "@/app/_platform/copy/client";

export function ShareGenerate({
  productSlug,
  entitySlug,
  entityName,
}: {
  productSlug: string;
  entitySlug: string;
  entityName: string;
}) {
  const { T, t } = useCopy();
  const [state, setState] = React.useState<"idle" | "sending" | "error">("idle");
  const [filed, setFiled] = React.useState<number | null>(null);

  async function generate() {
    if (state === "sending" || filed) return;
    setState("sending");
    try {
      const res = await fetch("/api/wishes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: productSlug,
          title: t("site.platform.research.share.sharegenerate.title-1", { entityName }),
          // The done-when names the artifact, the folder it lives in, and the
          // two skills that govern it — actionable without a conversation.
          body:
            t("site.platform.research.share.sharegenerate.body-1", { entitySlug }) +
            t("site.platform.research.share.sharegenerate.body-2", { entitySlug }) +
            t("site.platform.research.share.sharegenerate.body-3") +
            t("site.platform.research.share.sharegenerate.body-4") +
            t("site.platform.research.share.sharegenerate.body-5", { productSlug }),
          role: "PM",
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { wish?: { id: number } };
      if (!res.ok || !json.wish) {
        setState("error");
        return;
      }
      setFiled(json.wish.id);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  if (filed) {
    return (
      <Link
        href={`/${productSlug}/wishes?wish=${filed}`}
        className="pill info"
        title={t("site.platform.research.share.sharegenerate.title-2", { filed })}
        style={{ textDecoration: "none" }}
      >
        <T id="site.platform.research.share.sharegenerate.link-1" v={{ filed }} />
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={generate}
      disabled={state === "sending"}
      className="btn ghost"
      title={
        state === "error"
          ? t("site.platform.research.share.sharegenerate.button-1")
          : t("site.platform.research.share.sharegenerate.button-2", { entityName })
      }
      style={{ fontSize: 12 }}
    >
      {state === "sending" ? t("site.platform.research.share.sharegenerate.button-3") : state === "error" ? t("site.platform.research.share.sharegenerate.button-4") : t("site.platform.research.share.sharegenerate.button-5")}
    </button>
  );
}
