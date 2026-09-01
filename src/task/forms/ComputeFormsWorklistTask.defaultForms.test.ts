/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DRY_RUN } from "../../config/tokens";
// Deliberately not importing ProcessAccessionDocFormTask (or anything else
// that registers sec's form extractors as an import side effect): the whole
// point of this file is to exercise ComputeFormsWorklistTask on its own.
import { ComputeFormsWorklistTask } from "./ComputeFormsWorklistTask";

describe("ComputeFormsWorklistTask default form list", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("falls back to a non-empty form list when no driver has been imported", async () => {
    // The "all forms" default reads the form-extractor registry directly. If
    // this module does not populate that registry itself, and nothing else in
    // the process has imported ProcessAccessionDocFormTask, an omitted `form`
    // input silently resolves to an empty list — an empty sweep that exits 0
    // with no error.
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logs.push(String(message ?? ""));
    };
    try {
      await new ComputeFormsWorklistTask({ defaults: {} }).run({});
    } finally {
      console.log = originalLog;
    }

    const line = logs.find((l) => l.startsWith("Would process"));
    expect(line).toBeDefined();
    expect(line).toMatch(/forms: \S/);
  });
});
