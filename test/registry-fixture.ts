/**
 * The product registry, for every suite.
 *
 * Products are rows in the site database (app/lib/registry/core.ts). No test
 * touches a database over the network, so the registry is this fixture: the
 * shape production carries — one public demo, the rest private, one team.
 * A suite that needs a different registry sets the variable itself before it
 * imports anything; this only fills it in when it is empty.
 */
if (!process.env.PRODUCT_REGISTRY_FIXTURE) {
  process.env.PRODUCT_REGISTRY_FIXTURE = JSON.stringify([
    { slug: "ai-edu", teamSlug: "growth-labs", name: "Atlas Learn", tagline: "An AI tutor + course studio that adapts to every learner.", accent: "#356a4d", status: "active", visibility: "private", hasResearch: true },
    { slug: "inference-economics", teamSlug: "growth-labs", name: "Inference Economics", tagline: "推理经济学 2022–2028 — run an inference business on real formulas.", accent: "#9A2F66", status: "active", visibility: "public", hasResearch: false },
    { slug: "gtm", teamSlug: "growth-labs", name: "Second Product", tagline: "A second, private product.", accent: "#a4553a", status: "active", visibility: "private", hasResearch: true },
  ]);
}
