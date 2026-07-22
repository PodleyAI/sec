import { readFileSync } from "node:fs";
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

export default defineConfig({
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
    isolate: true,
  },
});
