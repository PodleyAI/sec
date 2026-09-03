/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { SEC_JSON_OUTPUT } from "../config/tokens";
import {
  drainNextSteps,
  renderNextSteps,
  resetNextStepsForTesting,
  setNextStepsQuiet,
  suggest,
} from "./nextSteps";

function captureLines(fn: () => void): string[] {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.join(" "));
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return lines;
}

afterEach(() => {
  resetNextStepsForTesting();
  resetDependencyInjectionsForTesting();
});

describe("nextSteps", () => {
  it("renders each command in a column with its reason", () => {
    suggest(
      { command: "sec read 0000320193-24-000123", why: "the latest 10-K, as markdown" },
      { command: 'sec ask "..."', why: "ask a question about it" }
    );
    const lines = captureLines(() => renderNextSteps(drainNextSteps()));
    expect(lines[0]).toBe("\n  Next:");
    expect(lines[1]).toContain("sec read 0000320193-24-000123");
    expect(lines[1]).toContain("the latest 10-K, as markdown");
    // Aligned: the shorter command is padded to the longer one.
    expect(lines[2]!.indexOf("ask a question")).toBe(lines[1]!.indexOf("the latest"));
  });

  it("drains, so a second command does not inherit the first's suggestions", () => {
    suggest({ command: "sec status", why: "see what is loaded" });
    expect(drainNextSteps()).toHaveLength(1);
    expect(drainNextSteps()).toHaveLength(0);
  });

  it("prints nothing when there is nothing to suggest", () => {
    expect(captureLines(() => renderNextSteps([]))).toEqual([]);
  });

  it("prints nothing under --quiet", () => {
    setNextStepsQuiet(true);
    suggest({ command: "sec status", why: "see what is loaded" });
    expect(captureLines(() => renderNextSteps(drainNextSteps()))).toEqual([]);
  });

  it("prints nothing under --json, where the steps are data the caller emits", () => {
    globalServiceRegistry.registerInstance(SEC_JSON_OUTPUT, true);
    suggest({ command: "sec status", why: "see what is loaded" });
    const steps = drainNextSteps();
    expect(captureLines(() => renderNextSteps(steps))).toEqual([]);
    // Still collected — a `--json` command puts them on its own payload.
    expect(steps).toHaveLength(1);
  });
});
