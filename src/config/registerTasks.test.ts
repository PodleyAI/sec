/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { TaskRegistry } from "workglow";
import { registerSecTasks, SEC_CLI_TASKS } from "./registerTasks";

/**
 * `task list` renders one row per registered task as `type` + `description`, so
 * a task registered without a description reads as a blank cell — the CLI's own
 * tasks all carry one, and sec's looked broken beside them until this was
 * enforced rather than remembered.
 */
describe("registerSecTasks", () => {
  registerSecTasks();

  // Iterate the curated list itself rather than filtering the registry by
  // category: a category filter silently covers a subset and still passes.
  const registered = SEC_CLI_TASKS;

  it("registers every curated task into the global registry", () => {
    for (const task of registered) {
      expect(TaskRegistry.all.get(task.type)).toBe(task);
    }
  });

  it("is idempotent, so a second entrypoint booting twice cannot throw", () => {
    expect(() => registerSecTasks()).not.toThrow();
  });

  it("gives every registered task a non-empty title and description", () => {
    const missing = registered
      .filter((ctor) => !ctor.title || !ctor.description)
      .map((ctor) => ctor.type);
    expect(missing).toEqual([]);
  });
});
