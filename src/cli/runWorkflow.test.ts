/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Type } from "typebox";
import { globalServiceRegistry, Task } from "workglow";
import { SEC_JSON_OUTPUT } from "../config/tokens";

const interactiveRun = vi.fn(async (): Promise<void> => {});

vi.mock("@workglow/cli", () => ({
  withCli: vi.fn(() => ({ run: interactiveRun })),
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
    interactiveRun.mockClear();
  });

  it("runs plainly in JSON mode so workflow errors can propagate to runCommand", async () => {
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, true);
    const { runWorkflowCli } = await import("./runWorkflow");

    const output = await runWorkflowCli<{ readonly value: string }>([
      new EchoTask({ defaults: { value: "ok" } }),
    ]);

    expect(output).toEqual({ value: "ok" });
    expect(interactiveRun).not.toHaveBeenCalled();
  });
});
