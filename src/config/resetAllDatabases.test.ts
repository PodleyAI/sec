/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Drift guard for `sec db reset --confirm`. `resetAllDatabases()` truncates a
 * hand-maintained list of repository tokens; if a new table is registered in
 * DefaultDI but its `deleteAll()` is forgotten here, a "reset" silently leaves
 * that table fully populated (orphan rows + dangling cross-tier references).
 *
 * This mirrors `form-wiring.test.ts`: it pins the data/wiring consistency at the
 * source level so a forgotten table fails CI instead of corrupting a "clean" DB.
 */
function repositoryTokens(relativePath: string): Set<string> {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  const tokens = source.match(/[A-Z0-9_]+_REPOSITORY_TOKEN/g) ?? [];
  return new Set(tokens);
}

describe("resetAllDatabases token coverage", () => {
  it("truncates every repository token registered in DefaultDI", () => {
    const registered = repositoryTokens("./DefaultDI.ts");
    const reset = repositoryTokens("./resetAllDatabases.ts");

    const missing = [...registered].filter((token) => !reset.has(token)).sort();
    expect(missing).toEqual([]);
  });
});
