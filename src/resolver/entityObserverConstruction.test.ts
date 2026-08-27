/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

const CONSTRUCTION = "new EntityObserver(";
/** `const observer: EntityObserver = new EntityObserver({` — the annotated local. */
const ANNOTATED_LOCAL = /\bconst\s+\w+\s*:\s*EntityObserver\b[^=]*=\s*new EntityObserver\(/;
/** `return new EntityObserver({` — anchored instead by the function's return type. */
const RETURNED = /^\s*return\s+new EntityObserver\(/;
const FUNCTION_START = /^\s*(?:export\s+)?(?:async\s+)?function\s/;
const RETURNS_OBSERVER = /\)\s*:\s*EntityObserver\s*\{/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "mock_data" || entry.name === "node_modules") continue;
      out.push(...tsFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
    out.push(full);
  }
  return out;
}

/**
 * Whether the enclosing function declares `EntityObserver` as its return type,
 * scanning up from the `return` to the nearest function header so a second
 * builder elsewhere in the file cannot vouch for this one.
 */
function enclosingFunctionReturnsObserver(lines: readonly string[], at: number): boolean {
  for (let i = at; i >= 0; i--) {
    if (!FUNCTION_START.test(lines[i])) continue;
    return RETURNS_OBSERVER.test(lines.slice(i, at + 1).join("\n"));
  }
  return false;
}

/** Every production construction, as `path:line`, that names no `EntityObserver` type. */
function unanchoredConstructions(): string[] {
  const found: string[] = [];
  for (const file of tsFiles(SRC_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.includes(CONSTRUCTION)) return;
      if (ANNOTATED_LOCAL.test(line)) return;
      if (RETURNED.test(line) && enclosingFunctionReturnsObserver(lines, index)) return;
      found.push(`${relative(SRC_DIR, file)}:${index + 1}`);
    });
  }
  return found;
}

describe("EntityObserver construction sites", () => {
  it("names the full resolver tier at every production site", () => {
    // The constructor's options type is inferred from the literal, and the
    // resolver tier is optional on it, so a site that dropped a resolver would
    // compile and then write observations with no canonical tier behind them —
    // no error, and nothing downstream to notice. Naming the type is what makes
    // the omission a type error, and it is only a guard where it is written.
    expect(unanchoredConstructions()).toEqual([]);
  });

  it("counts the sites it is guarding, so a scan that matches nothing fails", () => {
    // A regex guard that quietly stops finding its subject reports the same
    // empty list as a codebase in perfect order.
    const sites = tsFiles(SRC_DIR).filter((file) =>
      readFileSync(file, "utf8").includes(CONSTRUCTION)
    );
    expect(sites.length).toBeGreaterThanOrEqual(9);
  });
});
