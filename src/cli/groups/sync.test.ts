/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { addSyncCommand, validateLookback } from "./sync";
import { clearSyncLeavesForTesting, listSyncLeaves } from "../sync/syncLeaves";

describe("validateLookback", () => {
  it("rejects lookback below 1", () => {
    expect(() => validateLookback(0)).toThrow("--lookback must be at least 1");
  });

  it("returns the lookback when valid", () => {
    expect(validateLookback(3)).toBe(3);
  });
});

describe("sync --step help", () => {
  afterEach(() => {
    clearSyncLeavesForTesting();
  });

  it("lists each multi-step leaf's step ids on the --step option", () => {
    const program = new Command();
    addSyncCommand(program);
    const sync = program.commands.find((cmd) => cmd.name() === "sync");
    expect(sync).toBeDefined();

    for (const leaf of listSyncLeaves()) {
      const cmd = sync!.commands.find((c) => c.name() === leaf.id);
      expect(cmd, `sync ${leaf.id} command`).toBeDefined();
      const help = cmd!.helpInformation();
      const stepLine = help.split("\n").find((line) => line.includes("--step <name>"));

      if (leaf.steps.length <= 1) {
        expect(stepLine, `sync ${leaf.id} is single-step`).toBeUndefined();
        continue;
      }

      expect(stepLine, `sync ${leaf.id} --step`).toBeDefined();
      expect(stepLine).toContain(leaf.steps.map((step) => step.id).join(" | "));
    }
  });
});
