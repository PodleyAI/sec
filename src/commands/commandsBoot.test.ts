/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { AddCommands } from "./index";

/**
 * The whole CLI hangs off one static import graph: `sec.ts` calls
 * `AddCommands`, which pulls in every command group, which pulls in every task.
 * A single unresolved module or missing named export anywhere in that graph
 * makes the `sec` binary throw before Commander sees `argv` — so `sec --help`,
 * `sec db status` and every other subcommand die identically, with a module
 * resolution error rather than anything about SEC data.
 *
 * That happened: `src/task/eval/EvalS1Task.ts` imported
 * `setExtractionEffortOverride` from an `extractionReasoning` module that was
 * never committed, and three named exports (`preparedSectionText`,
 * `takeExtractionUsage`, `EvalExtractor.personNameFields`) that do not exist
 * either. Nothing in the suite imported the command graph, so a binary that
 * could not load reached `main` with tests green; CI only caught it at
 * `bun build`, whose failure looks like a bundler problem rather than a broken
 * product.
 *
 * This test costs one import and closes that gap: it fails at module load
 * against the pre-fix tree and passes after. Asserting a handful of registered
 * top-level names (rather than merely importing) additionally pins that each
 * `add*Commands` call really registered its group, so a group silently dropped
 * from the list is caught too.
 */
describe("CLI command graph", () => {
  it("registers every top-level command group without a module-load failure", () => {
    const program = new Command();
    AddCommands(program);

    const names = program.commands.map((c) => c.name());
    for (const expected of [
      "bootstrap",
      "sync",
      "update",
      "fetch",
      "query",
      "db",
      "init",
      "version",
      "resolve",
      "canonical",
      "spac",
      "editorial",
      "extractor",
      "eval",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("registers the eval subcommands the harness documents", () => {
    const program = new Command();
    AddCommands(program);

    const evalCmd = program.commands.find((c) => c.name() === "eval");
    expect(evalCmd).toBeDefined();
    const subNames = evalCmd!.commands.map((c) => c.name());
    expect(subNames).toContain("extract");
    expect(subNames).toContain("s1");
    expect(subNames).toContain("unit-terms");
  });
});
