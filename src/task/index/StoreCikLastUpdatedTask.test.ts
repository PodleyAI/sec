/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import { StoreCikLastUpdatedTask } from "./StoreCikLastUpdatedTask";

describe("StoreCikLastUpdatedTask", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("does not rewind an existing newer last_update on index lookback", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    await repo.put({ cik: 320193, last_update: "2026-08-17" });

    const result = await new StoreCikLastUpdatedTask().execute(
      {
        updateList: [
          [320193, "2026-08-14"],
          [1018724, "2026-08-14"],
        ],
      },
      ctx()
    );

    expect(result).toEqual({ success: true });
    expect((await repo.get({ cik: 320193 }))?.last_update).toBe("2026-08-17");
    expect((await repo.get({ cik: 1018724 }))?.last_update).toBe("2026-08-14");
  });

  it("keeps an equal last_update instead of deleting the row", async () => {
    const repo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    await repo.put({ cik: 320193, last_update: "2026-08-17" });

    const result = await new StoreCikLastUpdatedTask().execute(
      { updateList: [[320193, "2026-08-17"]] },
      ctx()
    );

    expect(result).toEqual({ success: true });
    expect((await repo.get({ cik: 320193 }))?.last_update).toBe("2026-08-17");
  });

  it("returns success false for an empty updateList without throwing", async () => {
    const result = await new StoreCikLastUpdatedTask().execute({ updateList: [] }, ctx());
    expect(result).toEqual({ success: false });
  });
});

function ctx(): IExecuteContext {
  return {
    signal: new AbortController().signal,
    updateProgress: () => {},
    own: <T>(v: T): T => v,
  } as unknown as IExecuteContext;
}
