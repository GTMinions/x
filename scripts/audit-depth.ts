/**
 * audit-depth — is every entity's score earned?
 *
 * A depth_score is an assertion an agent typed into a file. The ladder's gates
 * are predicates over the content, so this can check the assertion. Where they
 * disagree, the file is wrong.
 *
 * Read-only by default. `--fix` rewrites each overclaiming entity's score down to
 * the rung it actually earned, which is the honest correction: a page claiming a
 * depth it has not reached is worse than one that is honestly thin.
 *
 *   npx tsx scripts/audit-depth.ts          # report
 *   npx tsx scripts/audit-depth.ts --fix    # demote overclaims to their earned rung
 */
import fs from "node:fs";
import path from "node:path";
import { loadEntities, loadEdges, contentDir } from "../app/_platform/research/engine";
import { gateFor, earnedRung, rungFor } from "../app/_platform/research/depth";
import { productsWithResearch } from "./_scan";

const FIX = process.argv.includes("--fix");
let overclaimed = 0;
let fixed = 0;

for (const product of productsWithResearch()) {
  const entities = loadEntities(product);
  const inbound: Record<string, number> = {};
  const outbound: Record<string, number> = {};
  for (const e of loadEdges(product)) {
    inbound[e.to] = (inbound[e.to] ?? 0) + 1;
    outbound[e.from] = (outbound[e.from] ?? 0) + 1;
  }

  const bad: { slug: string; claimed: number; earned: number; missing: string }[] = [];

  for (const e of entities) {
    const ctx = { inbound: inbound[e.slug] ?? 0, outbound: outbound[e.slug] ?? 0 };
    const gate = gateFor(e, ctx);
    if (gate.overclaimed.length === 0) continue;

    const earned = earnedRung(e, ctx);
    bad.push({
      slug: e.slug,
      claimed: e.depth_score,
      earned: earned.min,
      missing: gate.overclaimed.map((r) => r.label).join("; "),
    });

    if (FIX) {
      const file = path.join(contentDir(product), "entities", `${e.slug}.json`);
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      raw.depth_score = earned.min;
      fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
      fixed += 1;
    }
  }

  overclaimed += bad.length;
  if (bad.length === 0) {
    console.log(`  ✓ ${product}: ${entities.length} entities, every score earned`);
    continue;
  }
  console.log(`  ! ${product}: ${bad.length}/${entities.length} overclaiming`);
  for (const b of bad.slice(0, 5)) {
    console.log(
      `      ${b.slug}: claims ${b.claimed} (${rungFor(b.claimed).label}) → earned ${b.earned} (${rungFor(b.earned).label})`,
    );
    console.log(`        missing: ${b.missing}`);
  }
  if (bad.length > 5) console.log(`      … and ${bad.length - 5} more`);
}

if (FIX) {
  console.log(`\n✓ audit-depth: demoted ${fixed} entities to their earned rung`);
} else if (overclaimed > 0) {
  console.log(
    `\n! audit-depth: ${overclaimed} entities claim a depth their content does not support.` +
      `\n  These are the top of the research backlog: add the missing evidence, or run --fix to score them honestly.`,
  );
} else {
  console.log("\n✓ audit-depth: every score is earned");
}
