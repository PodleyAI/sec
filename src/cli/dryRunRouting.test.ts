/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { Command } from "commander";
import { globalServiceRegistry } from "workglow";
import { SEC_DRY_RUN } from "../config/tokens";
import { applyGlobalOptions, parseGlobalOptions } from "./GlobalOptions";
import { isDryRun } from "./isDryRun";

/**
 * Pins the Commander behavior the CLI's dry-run handling is built around: when
 * the program declares a global `--dry-run` (as `applyGlobalOptions` does), a
 * `--dry-run` written AFTER a subcommand still resolves against the PROGRAM
 * option — a duplicate declaration on the subcommand never receives it. Every
 * action must therefore merge `isDryRun()` (fed from the program option via
 * the preAction hook) instead of trusting its own `opts.dryRun`. If a
 * commander upgrade changes this routing, this test flags it so the merged
 * reads can be simplified.
 */
describe("--dry-run option routing", () => {
  function build(): {
    program: Command;
    seen: { sub?: boolean; global?: boolean; jsonGlobal?: boolean };
  } {
    const seen: { sub?: boolean; global?: boolean; jsonGlobal?: boolean } = {};
    const program = new Command("sec").exitOverride();
    applyGlobalOptions(program);
    const group = program.command("group");
    group
      .command("do <arg>")
      .option("--dry-run", "subcommand-level flag")
      .action((_arg: string, opts: { dryRun?: boolean }) => {
        seen.sub = opts.dryRun === true;
        seen.global = parseGlobalOptions(program).dryRun;
        seen.jsonGlobal = parseGlobalOptions(program).json;
      });
    return { program, seen };
  }

  it("routes a post-subcommand --dry-run to the program-level option", async () => {
    const { program, seen } = build();
    await program.parseAsync(["node", "sec", "group", "do", "x", "--dry-run"]);
    expect(seen.global).toBe(true);
    expect(seen.sub).toBe(false);
  });

  it("routes a post-subcommand --json to the program-level option", async () => {
    const { program, seen } = build();
    await program.parseAsync(["node", "sec", "group", "do", "x", "--json"]);
    expect(seen.jsonGlobal).toBe(true);
  });

  it("neither option is set without the flag", async () => {
    const { program, seen } = build();
    await program.parseAsync(["node", "sec", "group", "do", "x"]);
    expect(seen.global).toBe(false);
    expect(seen.sub).toBe(false);
    expect(seen.jsonGlobal).toBe(false);
  });

  it("isDryRun reflects the registered SEC_DRY_RUN token", () => {
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    expect(isDryRun()).toBe(true);
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    expect(isDryRun()).toBe(false);
  });
});
