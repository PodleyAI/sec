/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { SEC_DRY_RUN } from "../../config/tokens";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { UpdateAllCompanyFactsTask } from "./UpdateAllCompanyFactsTask";

function ctx(): IExecuteContext {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    updateProgress: async () => {},
    own: <T>(v: T): T => v,
    registry: {
      has: () => false,
      get: () => {
        throw new Error("not registered");
      },
    } as any,
    resourceScope: {
      register: (_k: string, _fn: () => Promise<void>) => {},
      dispose: async () => {},
    } as any,
  } as IExecuteContext;
}

/**
 * The all-CIK read at the top of the task used `query({}, …)`, which the tabular
 * backend rejects ("Query criteria must not be empty. Use getAll()"). Only the
 * `update facts` path hits it (bootstrap uses a different task), so it stayed
 * hidden until a `--retry-failed` run. These dry-run tests exercise that read.
 */
describe("UpdateAllCompanyFactsTask all-CIK read", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    globalServiceRegistry.registerInstance(SEC_DRY_RUN, true);
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("does not throw on an empty cik_last_update table", async () => {
    const out = await new UpdateAllCompanyFactsTask().execute({ retryFailed: true }, ctx());
    expect(out.success).toBe(true);
  });

  it("reads all CIKs and selects previously failed ones for retry", async () => {
    await globalServiceRegistry
      .get(CIK_LAST_UPDATE_REPOSITORY_TOKEN)
      .put({ cik: 1018724, last_update: "2026-01-01" });
    await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).put({
      cik: 1018724,
      last_processed: "2026-01-02",
      success: false,
      reason_code: "STORE_ERROR",
      detail: "val_unit too long",
      attempts: 1,
    });

    const out = await new UpdateAllCompanyFactsTask().execute({ retryFailed: true }, ctx());
    expect(out.success).toBe(true);
  });
});
