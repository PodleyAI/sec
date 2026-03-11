import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { runCommand } from "./runCommand";

describe("runCommand", () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  afterAll(() => {
    process.exitCode = 0;
  });

  it("returns 0 on success", async () => {
    const action = mock(() => Promise.resolve());
    const code = await runCommand(action);
    expect(code).toBe(0);
    expect(process.exitCode).toBe(0);
  });

  it("calls the action function", async () => {
    const action = mock(() => Promise.resolve());
    await runCommand(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("returns 1 on error and calls onError callback", async () => {
    const error = new Error("boom");
    const action = mock(() => Promise.reject(error));
    const onError = mock(() => {});
    const code = await runCommand(action, { onError });
    expect(code).toBe(1);
    expect(process.exitCode).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("returns 1 on error and logs to stderr when no onError provided", async () => {
    const action = mock(() => Promise.reject(new Error("fail")));
    const stderrWrite = mock(() => true);
    const origWrite = process.stderr.write;
    process.stderr.write = stderrWrite as typeof process.stderr.write;
    try {
      const code = await runCommand(action);
      expect(code).toBe(1);
      expect(process.exitCode).toBe(1);
      expect(stderrWrite).toHaveBeenCalled();
      const output = stderrWrite.mock.calls[0][0] as string;
      expect(output).toContain("fail");
    } finally {
      process.stderr.write = origWrite;
    }
  });

  it("prints dry-run banner when SEC_DRY_RUN is set", async () => {
    const { globalServiceRegistry } = await import("@workglow/util");
    const { SEC_DRY_RUN } = await import("../config/tokens");
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    const action = mock(() => Promise.resolve());
    const origLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => logs.push(args.join(" "));
    try {
      const code = await runCommand(action);
      expect(code).toBe(0);
      expect(action).toHaveBeenCalledTimes(1);
      expect(logs.some((l) => l.includes("Dry run"))).toBe(true);
    } finally {
      console.log = origLog;
      globalServiceRegistry.registerInstance(SEC_DRY_RUN, false);
    }
  });

  it("sets process.exitCode to 0 on success", async () => {
    const action = mock(() => Promise.resolve());
    await runCommand(action);
    expect(process.exitCode).toBe(0);
  });

  it("sets process.exitCode to 1 on error", async () => {
    const action = mock(() => Promise.reject(new Error("oops")));
    await runCommand(action, { onError: () => {} });
    expect(process.exitCode).toBe(1);
  });
});
