/**
 * Generate a content-free stub of a product's data module.
 *
 * THE PROBLEM
 * `_store.ts` is imported, not read. `import { listLearners } from "../_store"`
 * is resolved by the compiler, so the file cannot simply be absent the way a
 * JSON corpus can — an absent module is a build error, not an empty list. But
 * the file is also where a product's content lives: for ai-edu, 2,575 of 3,965
 * lines are function bodies made of hardcoded prose. Leaving it in git leaves
 * the content in git.
 *
 * THE STUB
 * Keep every type, signature and export. Replace every body with a value that
 * carries no content:
 *
 *   - a module-level `const x: T[] = [ … ]`  →  `const x: T[] = []`
 *   - a function body                        →  `throw new Error(...)`
 *
 * `throw` satisfies any declared return type, so the stub type-checks against
 * the same consumers without inventing a fake shape for 155 different returns.
 *
 * WHAT THIS COSTS
 * A deployment with no database credential compiles, but calling one of these
 * functions raises instead of rendering a hollow page. That is the honest
 * failure: the page cannot be drawn without its data, and a blank page that
 * pretends to be the product is worse than an error that says the data is
 * missing. The real module is pulled from the product database before every
 * build, so this stub is only ever reached by a clone that has no credentials.
 *
 * Usage: npx tsx scripts/make-store-stub.ts <slug> [file]
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function stub(src: string, slug: string, file: string): string {
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

  const banner = `/**
 * GENERATED STUB — no content. The real module lives in this product's database
 * and is written here by \`pnpm product:db pull ${slug}\` before a build.
 *
 * Types and signatures are real, so everything that imports this still compiles.
 * Bodies are not: each one throws, because a page drawn from empty data would
 * look like a working product with nothing in it. Regenerate with
 * \`npx tsx scripts/make-store-stub.ts ${slug} ${file}\`.
 */\n`;

  while (i < lines.length) {
    const line = lines[i]!;

    // Preserve imports, types, interfaces and comments verbatim — they are the
    // contract, and they carry no content.
    if (/^(import|export type|type|export interface|interface)\b/.test(line)) {
      let depth = line.split("{").length - line.split("}").length;
      out.push(line);
      i++;
      while (i < lines.length && depth > 0) {
        depth += lines[i]!.split("{").length - lines[i]!.split("}").length;
        out.push(lines[i]!);
        i++;
      }
      continue;
    }

    // A module-level value: keep the declaration, drop what is inside it.
    // Both shapes appear — `const rows: T[] = [ … ]` and
    // `const lessons: Record<string, T> = { … }` — and an early version of this
    // script only matched the array, which quietly left every object literal's
    // prose in the stub.
    const decl = /^(export )?(const|let) (\w+)(:\s*[^=]+?)?\s*=\s*([[{])/.exec(line);
    if (decl) {
      const open = decl[5]!;
      const close = open === "[" ? "]" : "}";
      const count = (s: string) =>
        s.split(open).length - s.split(close).length;
      let depth = count(line);
      i++;
      while (i < lines.length && depth > 0) {
        depth += count(lines[i]!);
        i++;
      }
      const type = decl[4] ? decl[4].trimEnd() : "";
      // An empty object does not satisfy a type with required keys —
      // `Record<Severity, number> = {}` is an error, not an empty map. Cast
      // instead: the stub genuinely has no value here, and saying so through the
      // type system beats inventing keys. Arrays need no cast; `T[] = []` is valid.
      const empty =
        open === "{" && type
          ? `{} as ${type.replace(/^:\s*/, "")}`
          : `${open}${close}`;
      out.push(`${decl[1] ?? ""}${decl[2]} ${decl[3]}${type} = ${empty};`);
      continue;
    }

    // A function — keep the signature up to the opening brace, throw inside.
    if (/^(export )?(async )?function \w+/.test(line)) {
      const start = i;
      let depth = 0;
      let sawBrace = false;
      while (i < lines.length) {
        depth += lines[i]!.split("{").length - lines[i]!.split("}").length;
        if (lines[i]!.includes("{")) sawBrace = true;
        i++;
        if (sawBrace && depth <= 0) break;
      }
      // Find the brace that opens the BODY, by matching backwards from the
      // closing brace. Cutting at the first ` {` is wrong whenever the return
      // type is itself an object literal —
      //   export function strengthsFor(dev: string): {
      //     praise: string[];
      //   } {
      // — where the first ` {` opens the return type and truncating there
      // produces `): {` followed by a throw, which does not parse.
      const sig = lines.slice(start, i).join("\n");
      const end = sig.lastIndexOf("}");
      let braces = 0;
      let bodyOpen = -1;
      for (let c = end; c >= 0; c--) {
        if (sig[c] === "}") braces++;
        else if (sig[c] === "{") {
          braces--;
          if (braces === 0) { bodyOpen = c; break; }
        }
      }
      const head = bodyOpen > 0 ? sig.slice(0, bodyOpen).trimEnd() : sig;
      out.push(`${head} {`);
      out.push(`  throw new Error("${slug}: ${file} is a stub — run \`pnpm product:db pull ${slug}\`");`);
      out.push(`}`);
      continue;
    }

    out.push(line);
    i++;
  }

  return banner + out.join("\n");
}

const [slug, file = "_store.ts"] = process.argv.slice(2);
if (!slug) {
  console.error("usage: npx tsx scripts/make-store-stub.ts <slug> [file]");
  process.exit(1);
}

const src = path.join(ROOT, "app", "(products)", slug, file);
const dst = src.replace(/\.ts$/, ".stub.ts");
fs.writeFileSync(dst, stub(fs.readFileSync(src, "utf8"), slug, file));

const before = fs.readFileSync(src, "utf8").split("\n").length;
const after = fs.readFileSync(dst, "utf8").split("\n").length;
console.log(`  ${file} → ${path.basename(dst)}   ${before} → ${after} lines`);
