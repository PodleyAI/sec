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
      "setup",
      "status",
      "get",
      "update",
      "load",
      "show",
      "read",
      "fetch",
      "db",
      // Inherited from @workglow/cli, and the only evidence it registered.
      "web",
    ]) {
      expect(names).toContain(expected);
    }
  });

  it("registers every sync leaf as its own subcommand", () => {
    const program = new Command();
    AddCommands(program);

    const names = program.commands.map((c) => c.name());
    expect(names).toContain("update");

    const syncCmd = program.commands.find((c) => c.name() === "update");
    expect(syncCmd).toBeDefined();
    const subNames = syncCmd!.commands.map((c) => c.name());
    // The whole registry, in run order — a leaf dropped from
    // `registerSecSyncLeaves` is otherwise invisible, since the group still
    // builds and every other leaf still registers.
    expect(subNames).toEqual(["index", "submissions", "facts", "documents", "adv"]);
  });
});
