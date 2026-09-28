/**
 * Team loader — reads the agent org out of the `.claude` folders.
 *
 * The org belongs to the platform. Its agents live at `.claude/agents/*.md`, the
 * craft primitives they equip at `.claude/skills/<slug>/SKILL.md`, and the
 * corrections it is not allowed to forget at `.claude/memory/*.md`. Those files
 * are the org; nothing else defines it. `loadSiteOrg()` is the roster.
 *
 * A product may keep agents of its own under `app/(products)/<slug>/.claude`, and
 * those are the only ones `loadProductOrg()` returns — they belong to that product
 * and are confined to its folder by the pre-commit guardrail. Most products keep
 * none.
 *
 * Frontmatter is parsed by hand — a line parser is enough for `key: value` and
 * costs no dependency. Same fs + memo-cache shape as research/engine.ts: content
 * is read-only at runtime, so production parses once per process and dev re-reads
 * on every request.
 */
import fs from "node:fs";
import path from "node:path";

export type AgentScope = "platform" | "product";

export type Agent = {
  /** Route slug — the file name. Unique within its own scope. */
  slug: string;
  /** Frontmatter name, as written in the file. */
  name: string;
  description: string;
  /** From the `## Identity` line: "**Ada** · Research." → "Ada". */
  persona?: string;
  /** …and "Research". Falls back to the frontmatter name. */
  role?: string;
  /** First prose paragraph of the body — the agent in its own words. */
  remit?: string;
  /** Skill slugs the doctrine equips, resolved against the skills folders. */
  skills: string[];
  /** Frontmatter `model`, parsed but deliberately NOT rendered: which model an
   *  agent runs on is the operator's business and differs per deployment. Kept
   *  on the type because the local runner reads the same frontmatter. */
  model?: string;
  tools?: string[];
  scope: AgentScope;
  /** Set only on a product's own agent. */
  productSlug?: string;
  /** The markdown body, minus frontmatter. Rendered on the detail page. */
  body: string;
};

export type Skill = {
  slug: string;
  name: string;
  description: string;
  scope: AgentScope;
  /** Slugs of the agents that equip it. Empty = carried by nobody. */
  equippedBy: string[];
};

/** A correction the org made once and wrote down so the next run inherits it. */
export type MemoryNote = {
  slug: string;
  name: string;
  description: string;
};

function siteClaudeDir(): string {
  return path.join(process.cwd(), ".claude");
}

function productClaudeDir(productSlug: string): string {
  // Route-group folders keep their literal parens on disk.
  return path.join(process.cwd(), "app", "(products)", productSlug, ".claude");
}

// ── frontmatter ──────────────────────────────────────────────────────────────

type Frontmatter = { data: Record<string, string>; body: string };

function splitFrontmatter(raw: string): Frontmatter {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, body: raw };
  const data: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "---") { i++; break; }
    const colon = line.indexOf(":");
    if (colon <= 0) continue;                    // continuation / list line — ignore
    const key = line.slice(0, colon).trim();
    if (/^\s/.test(line)) continue;              // nested key
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: lines.slice(i).join("\n").trim() };
}

/** "**Ada** · Research.  Depth-ladder enforcer." → { persona, role } */
function parseIdentity(body: string): { persona?: string; role?: string } {
  const lines = body.split("\n");
  const head = lines.findIndex((l) => /^#{1,4}\s+.*\bIdentity\b/i.test(l));
  if (head === -1) return {};
  for (let i = head + 1; i < Math.min(head + 6, lines.length); i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const m = /^\*\*(.+?)\*\*\s*[·•·-]\s*(.+)$/.exec(line);
    if (!m) return {};
    const persona = m[1].trim();
    // The role runs to the first sentence stop. "Head of Brand & Communications."
    const role = m[2].split(/\.(?:\s|$)/)[0].trim();
    return { persona, role: role || undefined };
  }
  return {};
}

/** Boilerplate that opens several of these files. It is not anybody's remit. */
const NOT_A_REMIT = /^(sub-agents spawned|read `?\.claude|this file \*?is)/i;

/** The first paragraph of real prose — not a heading, quote, table, or list. */
function parseRemit(body: string): string | undefined {
  for (const block of body.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b || /^[#>|\-*`]|^\d+\./.test(b)) continue;
    const flat = b.replace(/\s+/g, " ").replace(/\*\*/g, "").replace(/`/g, "");
    if (flat.length < 60 || NOT_A_REMIT.test(flat)) continue;
    return flat;
  }
  return undefined;
}

const SKILL_REF = /\.claude\/skills\/([a-z0-9][a-z0-9-_]*)/g;

/**
 * Skill slugs the doctrine equips. Prefer the "Skills equipped" section — that is
 * the agent's own declared kit. Agents that never wrote one (the orchestrator, the
 * philosopher) still cite skills inline, so fall back to the whole body rather
 * than report an empty kit for an agent that plainly carries one.
 */
function parseSkills(body: string, known: Set<string>): string[] {
  const lines = body.split("\n");
  let start = -1;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,4})\s+(.*)$/.exec(lines[i]);
    if (m && /skills/i.test(m[2])) { start = i + 1; depth = m[1].length; break; }
  }
  let scope = body;
  if (start !== -1) {
    let end = lines.length;
    for (let i = start; i < lines.length; i++) {
      const m = /^(#{1,4})\s+/.exec(lines[i]);
      if (m && m[1].length <= depth) { end = i; break; }
    }
    scope = lines.slice(start, end).join("\n");
  }
  const found = new Set<string>();
  for (const m of scope.matchAll(SKILL_REF)) {
    if (known.has(m[1])) found.add(m[1]);
  }
  if (!found.size && start !== -1) {
    for (const m of body.matchAll(SKILL_REF)) if (known.has(m[1])) found.add(m[1]);
  }
  return [...found].sort();
}

// ── readers ──────────────────────────────────────────────────────────────────

function readSkills(dir: string, scope: AgentScope): Skill[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
  const skills: Skill[] = [];
  for (const slug of entries) {
    const file = path.join(dir, slug, "SKILL.md");
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const { data } = splitFrontmatter(raw);
    skills.push({
      slug,
      name: data.name || slug,
      description: data.description || "",
      scope,
      equippedBy: [],
    });
  }
  return skills.sort((a, b) => a.slug.localeCompare(b.slug));
}

function readAgents(dir: string, scope: AgentScope, known: Set<string>, productSlug?: string): Agent[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const agents: Agent[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), "utf8");
    } catch (err) {
      console.error(`[team] unreadable agent ${f}:`, err);
      continue;
    }
    const { data, body } = splitFrontmatter(raw);
    const name = data.name || f.replace(/\.md$/, "");
    const { persona, role } = parseIdentity(body);
    agents.push({
      slug: name,
      name,
      description: data.description || "",
      persona,
      role: role || name,
      remit: parseRemit(body),
      skills: parseSkills(body, known),
      model: data.model || undefined,
      tools: data.tools ? data.tools.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
      scope,
      productSlug,
      body,
    });
  }
  return agents.sort((a, b) => a.name.localeCompare(b.name));
}

/** `.claude/memory/*.md`. MEMORY.md is the hand-written index of the rest — skip it. */
function readMemory(dir: string): MemoryNote[] {
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md");
  } catch {
    return [];
  }
  const notes: MemoryNote[] = [];
  for (const f of files) {
    let raw: string;
    try {
      raw = fs.readFileSync(path.join(dir, f), "utf8");
    } catch {
      continue;
    }
    const { data } = splitFrontmatter(raw);
    const slug = f.replace(/\.md$/, "");
    notes.push({ slug, name: data.name || slug, description: data.description || "" });
  }
  return notes.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Which agents carry each skill. A skill nobody equips is vocabulary the org wrote down and never picked up. */
function backlink(agents: Agent[], skills: Skill[]): void {
  const byId = new Map(skills.map((s) => [s.slug, s]));
  for (const a of agents) {
    for (const slug of a.skills) byId.get(slug)?.equippedBy.push(a.slug);
  }
}

// ── the site org — the roster ────────────────────────────────────────────────

export type SiteOrg = {
  agents: Agent[];
  skills: Skill[];
  memory: MemoryNote[];
};

/** A product's own agents. Empty for a product that hired none, which is most of them. */
export type ProductOrg = {
  productSlug: string;
  agents: Agent[];
  skills: Skill[];
};

const CACHE = process.env.NODE_ENV === "production";
let _site: SiteOrg | null = null;
const _products = new Map<string, ProductOrg>();

/** The platform org. These agents work on every product. */
export function loadSiteOrg(): SiteOrg {
  if (CACHE && _site) return _site;

  const dir = siteClaudeDir();
  const skills = readSkills(path.join(dir, "skills"), "platform");
  const known = new Set(skills.map((s) => s.slug));
  const agents = readAgents(path.join(dir, "agents"), "platform", known);
  backlink(agents, skills);

  const org: SiteOrg = { agents, skills, memory: readMemory(path.join(dir, "memory")) };
  if (CACHE) _site = org;
  return org;
}

/**
 * Only what the product itself keeps. A product agent may equip a platform skill,
 * so those slugs resolve against both folders — but the back-link stays inside the
 * product's own skills, or a product's agents would leak into the memoised site org.
 */
export function loadProductOrg(productSlug: string): ProductOrg {
  const cached = _products.get(productSlug);
  if (CACHE && cached) return cached;

  const dir = productClaudeDir(productSlug);
  const skills = readSkills(path.join(dir, "skills"), "product");
  const known = new Set([...skills.map((s) => s.slug), ...loadSiteOrg().skills.map((s) => s.slug)]);
  const agents = readAgents(path.join(dir, "agents"), "product", known, productSlug);
  backlink(agents, skills);

  const org: ProductOrg = { productSlug, agents, skills };
  if (CACHE) _products.set(productSlug, org);
  return org;
}

export function loadSiteAgent(agentSlug: string): Agent | null {
  return loadSiteOrg().agents.find((a) => a.slug === agentSlug) ?? null;
}

/** Every /about/<agent> route — for generateStaticParams. */
export function siteAgentSlugs(): string[] {
  return loadSiteOrg().agents.map((a) => a.slug);
}
