/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { commandNeedsSecRuntime } from "./cliRuntimeGate";

/** Builds `parent child` the way commander nests them. */
function leaf(parent: string, child: string): Command {
  const root = new Command(parent);
  const sub = new Command(child);
  root.addCommand(sub);
  return sub;
}

describe("commandNeedsSecRuntime", () => {
  it("boots for the leaves that execute a task graph", () => {
    for (const group of ["task", "workflow", "agent"]) {
      expect(commandNeedsSecRuntime(leaf(group, "run"))).toBe(true);
    }
  });

  it("leaves `init` alone, which is what writes the configuration", () => {
    expect(commandNeedsSecRuntime(new Command("init"))).toBe(false);
  });

  it("does not boot to list or describe tasks, so browsing works unconfigured", () => {
    expect(commandNeedsSecRuntime(leaf("task", "list"))).toBe(false);
    expect(commandNeedsSecRuntime(leaf("task", "detail"))).toBe(false);
  });

  it("does not boot for the commands that read no SEC data", () => {
    for (const name of ["model", "mcp", "credential", "web"]) {
      expect(commandNeedsSecRuntime(new Command(name))).toBe(false);
    }
    expect(commandNeedsSecRuntime(leaf("model", "list"))).toBe(false);
  });
});
