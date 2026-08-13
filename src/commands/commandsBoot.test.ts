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
 * makes the `sec` binary throw before Commander ever sees `argv` — so
 * `sec --help`, `sec db status` and every other subcommand die identically,
 * with a module-resolution error that says nothing about SEC data.
 *
 * Nothing else in the suite imports the command graph, which is how that state
 * reached a shipping branch once already: the eval tasks were merged carrying
 * imports for `setExtractionEffortOverride`, `preparedSectionText`,
 * `takeExtractionUsage` and `EvalExtractor.personNameFields` while the modules
 * defining them sat unmerged on another branch. Every test stayed green,
 * because none of them loaded a command; only `bun build` failed, and a bundler
 * error reads as a packaging problem rather than a product that will not start.
 *
 * This test costs one import and closes that gap — it fails at module load
 * against any tree whose command graph does not resolve. Asserting the
 * registered top-level names, rather than merely importing, additionally pins
 * that each `add*Commands` call really registered its group, so a group
 * silently dropped from the list is caught by the same case.
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
