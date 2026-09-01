/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { clearSyncLeavesForTesting, listSyncLeaves } from "../sync/syncLeaves";
import { addSyncCommand, validateLookback } from "./sync";

describe("validateLookback", () => {
  it("rejects lookback below 1", () => {
    expect(() => validateLookback(0)).toThrow("--lookback must be at least 1");
  });

  it("returns the lookback when valid", () => {
    expect(validateLookback(3)).toBe(3);
  });
});

describe("sync leaf subcommands", () => {
  afterEach(() => {
    clearSyncLeavesForTesting();
  });

  it("gives a multi-step leaf an `all` plus one subcommand per step", () => {
    const program = new Command();
    addSyncCommand(program);
    const sync = program.commands.find((cmd) => cmd.name() === "sync");
    expect(sync).toBeDefined();

    for (const leaf of listSyncLeaves()) {
      if (leaf.id === "forms") continue; // takes a <types> argument, not steps
      const cmd = sync!.commands.find((c) => c.name() === leaf.id);
      expect(cmd, `sync ${leaf.id} command`).toBeDefined();
      const subs = cmd!.commands.map((c) => c.name()).filter((name) => name !== "help");

      if (leaf.steps.length <= 1) {
        // Nothing to choose between, so `sync facts all` would only be a longer
        // way to say `sync facts`.
        expect(subs, `sync ${leaf.id} is single-step`).toEqual([]);
        continue;
      }

      expect(subs, `sync ${leaf.id} subcommands`).toEqual([
        "all",
        ...leaf.steps.map((step) => step.id),
      ]);
    }
  });

  it("names the steps in help rather than hiding them behind --step", () => {
    const program = new Command();
    addSyncCommand(program);
    const sync = program.commands.find((cmd) => cmd.name() === "sync");
    const submissions = sync!.commands.find((c) => c.name() === "submissions");
    const help = submissions!.helpInformation();

    expect(help).toContain("index");
    expect(help).toContain("submissions");
    // The option it replaced: a step list only `--help` could show, and no
    // shell could complete.
    expect(help).not.toContain("--step <name>");
  });

  it("carries the leaf's options onto every subcommand, not just the group", () => {
    // Commander does not hand a parent's options to a subcommand's action, so
    // an option declared once on the group would parse and then be dropped.
    const program = new Command();
    addSyncCommand(program);
    const sync = program.commands.find((cmd) => cmd.name() === "sync");
    const submissions = sync!.commands.find((c) => c.name() === "submissions");

    for (const name of ["all", "index", "submissions"]) {
      const sub = submissions!.commands.find((c) => c.name() === name);
      const flags = sub!.options.map((option) => option.long);
      expect(flags, `sync submissions ${name}`).toContain("--force");
      expect(flags, `sync submissions ${name}`).toContain("--from");
      expect(flags, `sync submissions ${name}`).toContain("--lookback");
    }
  });

  it("leaves a group with no action, so bare `sync submissions` needs no configuration", () => {
    // An action would route a help listing through the CLI's preAction hook,
    // which refuses to run until `init` has been done — so asking what a group
    // contains would demand a configured database.
    const program = new Command();
    addSyncCommand(program);
    const sync = program.commands.find((cmd) => cmd.name() === "sync");
    const submissions = sync!.commands.find((c) => c.name() === "submissions");
    expect((submissions as unknown as { _actionHandler?: unknown })._actionHandler).toBeFalsy();
  });
});
