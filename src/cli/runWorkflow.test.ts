/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry, Task } from "workglow";
import { SEC_JSON_OUTPUT } from "../config/tokens";

/**
 * `withCli` decides what a run does with itself — draw Ink on a TTY, report to a
 * watching parent, or run plainly — so these tests assert what sec HANDS it,
 * not whether sec calls it. Branching here instead is what made every piped run
 * invisible to the web console, which runs commands as child processes.
 */
const withCliCalls: Array<{ interactive: boolean | undefined }> = [];

vi.mock("@workglow/cli", () => ({
  withCli: vi.fn(
    (wf: { run: (input?: unknown) => Promise<unknown> }, options?: { interactive?: boolean }) => {
      withCliCalls.push({ interactive: options?.interactive });
      return { run: (input?: unknown) => wf.run(input) };
    }
  ),
}));

class EchoTask extends Task<{ readonly value: string }, { readonly value: string }> {
  static readonly type = "RunWorkflowTestEchoTask";

  public static inputSchema() {
    return Type.Object({ value: Type.String() });
  }

  public static outputSchema() {
    return Type.Object({ value: Type.String() });
  }

  async execute(input: { readonly value: string }): Promise<{ readonly value: string }> {
    return input;
  }
}

describe("runWorkflowCli", () => {
  afterEach(() => {
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, false);
    withCliCalls.length = 0;
  });

  it("draws no terminal UI in JSON mode, whose stdout Ink's rows would interleave with", async () => {
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, true);
    const { runWorkflowCli } = await import("./runWorkflow");

    const output = await runWorkflowCli<{ readonly value: string }>([
      new EchoTask({ defaults: { value: "ok" } }),
    ]);

    expect(output).toEqual({ value: "ok" });
    expect(withCliCalls).toEqual([{ interactive: false }]);
  });

  it("still goes through withCli off a TTY, so a watching parent gets the run's events", async () => {
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, false);
    const originalIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      const { runWorkflowCli } = await import("./runWorkflow");
      const output = await runWorkflowCli<{ readonly value: string }>([
        new EchoTask({ defaults: { value: "ok" } }),
      ]);
      expect(output).toEqual({ value: "ok" });
      // Off a TTY `withCli` runs plainly by itself — no Ink in a redirected
      // shard's logfile — but it must still be the thing running the graph, or
      // the run reports nothing to the console that started it.
      expect(withCliCalls).toEqual([{ interactive: true }]);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });
});
