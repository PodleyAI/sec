/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TASK_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(TASK_DIR, "..");

/** `export class Foo extends Task<...>` / `class Foo extends SecCachedFetchTask<...>` */
const CLASS_RE = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)\s+extends\s+(\w+)</;
const TASK_BASES = new Set([
  "Task",
  "GraphAsTask",
  "IteratorTask",
  "SecFetchTask",
  "SecCachedFetchTask",
]);

interface TaskClass {
  readonly file: string;
  readonly name: string;
  readonly title: string | undefined;
}

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
 * The CLI progress UI labels every row with the task's `title` (falling back to
 * the class type name), so a task without one renders as an opaque class name —
 * and two instances of the same class become indistinguishable rows. Collect
 * every task class by source scan; there is no runtime registry that holds them
 * all.
 */
function collectTaskClasses(): TaskClass[] {
  const found: TaskClass[] = [];
  for (const file of tsFiles(TASK_DIR)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let open: { name: string; start: number } | undefined;
    const close = (end: number): void => {
      if (!open) return;
      const body = lines.slice(open.start, end);
      const title = body
        .map((l) => /^\s*static (?:readonly )?title(?::\s*\w+)? = "([^"]*)"/.exec(l)?.[1])
        .find((t) => t !== undefined);
      found.push({ file: relative(SRC_DIR, file), name: open.name, title });
      open = undefined;
    };
    for (let i = 0; i < lines.length; i++) {
      const m = CLASS_RE.exec(lines[i]);
      if (!m) continue;
      close(i);
      if (TASK_BASES.has(m[2])) open = { name: m[1], start: i };
    }
    close(lines.length);
  }
  return found;
}

describe("task titles", () => {
  const classes = collectTaskClasses();

  it("finds the task classes to check", () => {
    expect(classes.length).toBeGreaterThan(50);
  });

  it("every task class declares a non-empty static title", () => {
    const untitled = classes
      .filter((c) => c.title === undefined || c.title.length === 0)
      .map((c) => `${c.file}: ${c.name}`);
    expect(untitled).toEqual([]);
  });
});
