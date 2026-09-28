/**
 * EvolvementSection — the server half of the Evolvement view.
 *
 * Mirrors ResearchIndex: a product's route passes a slug and gets a whole
 * surface, so adding Evolvement to a product stays a three-line route. Reading
 * the build artefacts is spine work and belongs here, not in a product folder.
 *
 * The graph leads and the statistics follow. A reader arrives here asking what the
 * corpus looks like and how it got that way; the shape answers both at a glance,
 * and the counts underneath are the audit trail for what the shape claims. Note
 * that the two survive each other: a corpus git has never seen still HAS a
 * topology, so TopologyGraph renders whole (minus its scrubber) while Evolvement
 * below it correctly reports that there is no history to replay.
 */
import React from "react";
import { loadEvolvement } from "./history";
import { Evolvement } from "./Evolvement";
import { TopologyGraph } from "./TopologyGraph";
import { T } from "@/app/_platform/copy";

export function EvolvementSection({ productSlug }: { productSlug: string }) {
  const data = loadEvolvement(productSlug);

  if (!data) {
    return (
      <div className="card">
        <div className="eyebrow"><T id="site.platform.research.evolvementsection.div-1" /></div>
        <p style={{ marginTop: 10, color: "var(--ink-soft)", maxWidth: 620 }}>
          <T id="site.platform.research.evolvementsection.p-1" v={{ productSlug }} c={[<code />, <code />, <code />, <code />, <code />, <code />]} />
        </p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 28 }}>
      <TopologyGraph productSlug={productSlug} nodes={data.nodes} edges={data.edges} />
      <Evolvement
        productSlug={productSlug}
        nodes={data.nodes}
        history={data.history}
        generatedAt={data.generatedAt}
        shallow={data.shallow}
      />
    </div>
  );
}
