"use client";

/**
 * SectionDive — "this section is too thin."
 *
 * The affordance that closes the loop between the reader and the research. A
 * reader who hits a shallow section has, at that moment, the most precise signal
 * anyone will ever have about where the corpus is weak. This files that signal as
 * a wish, scoped to the exact entity and section, with a done-when concrete
 * enough for the researcher to act on without a conversation.
 *
 * It used to file the wish and then say "filed" — no number, no link, nothing to
 * open. It worked; it just left no evidence that it had. A person who cannot see
 * what their click produced concludes it produced nothing, and they are right to:
 * an action with no receipt is indistinguishable from a no-op. So it hands back
 * the wish number and a link to it, and from that second the wish is a real thing
 * with a thread and a timeline.
 */
import React from "react";
import Link from "next/link";
import { useCopy } from "@/app/_platform/copy/client";

export function SectionDive({
  productSlug,
  entitySlug,
  entityName,
  section,
}: {
  productSlug: string;
  entitySlug: string;
  entityName: string;
  section: string;
}) {
  const { T, t } = useCopy();
  const [state, setState] = React.useState<"idle" | "sending" | "error">("idle");
  const [filed, setFiled] = React.useState<number | null>(null);

  async function dive() {
    if (state === "sending" || filed) return;
    setState("sending");
    try {
      const res = await fetch("/api/wishes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scope: productSlug,
          title: t("site.platform.research.sectiondive.title-1", { entityName, section }),
          // The done-when is the whole point: it is what makes this actionable
          // rather than a complaint. It names the rung, the evidence, and the date.
          body:
            t("site.platform.research.sectiondive.body-1", { section, entitySlug }) +
            t("site.platform.research.sectiondive.body-2") +
            t("site.platform.research.sectiondive.body-3") +
            t("site.platform.research.sectiondive.body-4"),
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

  // Once it is filed the control stops being a button and becomes the receipt: a
  // wish number you can open, not a word that says a wish exists somewhere.
  if (filed) {
    return (
      <Link
        href={`/${productSlug}/wishes?wish=${filed}`}
        className="pill info"
        title={t("site.platform.research.sectiondive.title-2", { filed })}
        style={{ textDecoration: "none" }}
      >
        <T id="site.platform.research.sectiondive.link-1" v={{ filed }} />
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={dive}
      disabled={state === "sending"}
      className="btn ghost"
      title={state === "error" ? t("site.platform.research.sectiondive.button-1") : t("site.platform.research.sectiondive.button-2", { section })}
      style={{ fontSize: 11, padding: "2px 8px" }}
    >
      ↓ {state === "sending" ? t("site.platform.research.sectiondive.button-3") : state === "error" ? t("site.platform.research.sectiondive.button-4") : t("site.platform.research.sectiondive.button-5")}
    </button>
  );
}
