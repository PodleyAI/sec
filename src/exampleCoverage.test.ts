/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/** Every `.ts` under `src/`, tests included. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "mock_data" || entry === "node_modules") continue;
      sourceFiles(full, out);
      continue;
    }
    if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * The README's "What does the work" table is a promise about which parts of the
 * library this example actually exercises. It is checked, because the promise
 * this repo made before — "an example of using the Workglow AI library" — was
 * true of a tree with no AI call in it for long enough that nobody noticed.
 */
describe("the README's claims about what it demonstrates", () => {
  const readme = readFileSync(join(ROOT, "README.md"), "utf-8");
  const sources = sourceFiles(join(ROOT, "src"));
  const corpus = sources.map((file) => readFileSync(file, "utf-8")).join("\n");

  it("names a real path for every row of the table", () => {
    // Each row ends in one or more backticked paths under `src/`.
    const paths = [...readme.matchAll(/`(src\/[^`]+)`/g)].map((match) => match[1]!);
    expect(paths.length).toBeGreaterThan(5);
    for (const path of new Set(paths)) {
      const cleaned = path.replace(/\/$/, "");
      expect(() => statSync(join(ROOT, cleaned)), cleaned).not.toThrow();
    }
  });

  it("demonstrates every `@workglow/*` package it says it does", () => {
    const claimed = new Set(
      [...readme.matchAll(/`(@workglow\/[a-z-]+)`/g)].map((match) => match[1]!)
    );
    expect(claimed.size).toBeGreaterThan(4);

    // Reached through the `workglow` meta package, so a bare import of the
    // scoped name is not the evidence — the symbols are. One well-known export
    // per package stands for it.
    const witness: Readonly<Record<string, string>> = {
      "@workglow/job-queue": "RateLimiter",
      "@workglow/storage": "ITabularStorage",
      "@workglow/sqlite": "SqliteTabularStorage",
      "@workglow/postgres": "PostgresTabularStorage",
      "@workglow/task-graph": "Task",
      "@workglow/knowledge-base": "KnowledgeBase",
      "@workglow/ai": "createStandardKbStrategy",
      "@workglow/huggingface-transformers": "hf-transformers",
      "@workglow/anthropic": "anthropic/runtime",
      "@workglow/cli": "@workglow/cli",
    };

    const unproven = [...claimed].filter((pkg) => {
      const symbol = witness[pkg];
      // A package the README names and this test has no witness for is itself a
      // failure: the check is only worth anything if it covers the whole claim.
      return symbol === undefined || !corpus.includes(symbol);
    });
    expect(unproven).toEqual([]);
  });
});
