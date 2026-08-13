/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { AddCommands } from "./index";

/**
 * Asserts the registered command TREE, against `program.commands`, rather than
 * against `--help` text.
 *
 * `cli.integration.test.ts` already boots the real binary in a subprocess, so a
 * module that fails to resolve anywhere in the command graph fails there
 * loudly — that is the check for "does the CLI start at all", and this file is
 * not a second copy of it.
 *
 * What a help-text check cannot do is prove a group was REGISTERED. It matches
 * a substring of prose, and ten of the sixteen group names appear more than
 * once in `sec --help`: `version` appears as the `-V, --version` global option
 * and inside two descriptions, `resolve` four times, `fetch` three. Unregister
 * the `version` group and `toContain("version")` still passes, because the
 * global option supplies the string. Matching `c.name()` exactly is the only
 * form no amount of description text can satisfy by accident.
 *
 * It costs one in-process import, and it needs no subprocess — so it also
 * covers the graph on a runner where spawning `bun` is unavailable.
 */
describe("CLI command graph", () => {
  it("registers every top-level command group", () => {
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
      // Registered by registerUnderwriterFamilyCommands / the issuer query
      // group, and the only top-level evidence either of them ran.
      "underwriter",
      "issuer",
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
