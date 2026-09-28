import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Tests run against the real modules, in Node, with two substitutions:
 *
 *   server-only  → a no-op. The guard exists to keep server code out of a
 *                  client bundle; under Node there is no bundle, and the real
 *                  package throws on import. Stubbing it in the harness keeps
 *                  the guard intact in the code that ships.
 *   @/*          → the repo root, matching tsconfig's path alias.
 *
 * Storage is a throwaway SQLite file per suite, set by the suite itself. No
 * test touches Turso, GitHub, or anything on the network.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(new URL("./test/server-only.stub.ts", import.meta.url)),
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // The product registry is a database; the suites read a fixture instead.
    setupFiles: ["./test/registry-fixture.ts"],
    // Each suite owns a database file and mutates module-level caches, so they
    // must not share a process.
    fileParallelism: false,
    restoreMocks: true,
  },
});
