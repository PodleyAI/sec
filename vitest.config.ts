import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Test runner config. The suite was authored for vitest (the vast majority of
 * test files import from "vitest") but historically executed under `bun test`,
 * which runs every file in one shared process — letting module singletons like
 * `globalServiceRegistry` leak state across files. Vitest isolates each test
 * file, which removes that whole class of cross-file pollution.
 */

/** Minimal .env parser — avoids a direct `vite`/`dotenv` dependency. */
function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  let contents: string;
  try {
    contents = readFileSync(path, "utf-8");
  } catch {
    return out; // no .env.test present (e.g. some CI matrix) — fine
  }
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * The published `workglow` package is ESM but its `dist/node.js` re-exports
 * `./common` and its subpath entries re-export `./common.browser`/`.bun` etc.
 * without a `.js` extension. Node's strict ESM loader rejects those bare
 * specifiers, so vitest cannot import a test file that transitively pulls in
 * `workglow`. Append the extension when a `workglow` internal path resolves to
 * something without one and the `.js` file exists on disk.
 */
const workglowExtensionFixup = {
  name: "workglow-esm-extension-fixup",
  enforce: "pre" as const,
  resolveId(source: string, importer: string | undefined) {
    if (!importer) return null;
    if (!importer.includes("/workglow/dist/")) return null;
    if (source.startsWith(".") && !/\.[a-z]+$/i.test(source)) {
      const importerDir = importer.slice(0, importer.lastIndexOf("/"));
      const candidate = resolve(importerDir, `${source}.js`);
      if (existsSync(candidate)) return candidate;
    }
    return null;
  },
};

export default defineConfig({
  plugins: [workglowExtensionFixup],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Multi-spawn CLI integration tests fire several sequential `sec` subprocess
    // invocations; keep the generous timeout the bun runner used.
    testTimeout: 30_000,
    // Load .env.test into the test workers' process.env, matching the auto-load
    // that `bun test` previously provided.
    env: loadEnvFile(resolve(process.cwd(), ".env.test")),
    // Each test file gets a fresh module registry — no shared global state.
    // (In vitest v4 the previous per-pool `poolOptions.forks.isolate` moved to
    // this top-level `isolate` knob; setting it here still routes through the
    // fork pool selected below.)
    isolate: true,
    // Run each test file in its own forked process (not a worker thread). Forks
    // give better isolation for native modules (better-sqlite3, onnxruntime)
    // and match how a real `sec` CLI subprocess sees the module graph, at the
    // cost of slower cold starts.
    pool: "forks",
    server: {
      deps: {
        // Route `workglow` (and every intra-workglow re-export) through
        // vitest's transform pipeline. Without this, vitest externalizes the
        // package and Node's strict ESM loader chokes on workglow's own
        // `./common` re-export (which has no `.js` extension). The extension
        // fixup plugin above supplies the missing `.js` once Vite handles the
        // resolution.
        inline: [/workglow/],
      },
    },
  },
});
