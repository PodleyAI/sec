/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry, type IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../../storage/entity/EntityHistorySchema";
import { StoreSubmissionNameHistoryTask } from "./StoreSubmissionNameHistoryTask";

const ctx = {
  signal: new AbortController().signal,
  updateProgress: () => {},
} as unknown as IExecuteContext;

const renamed = {
  cik: 1277021,
  name: "VISANT HOLDING CORP",
  sic: "3911",
  formerNames: [
    {
      name: "JOSTENS HOLDING CORP",
      from: "2004-01-21T00:00:00.000Z",
      to: "2005-02-14T00:00:00.000Z",
    },
  ],
};

const history = async (cik: number) =>
  await globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN).query({ cik });

describe("StoreSubmissionNameHistoryTask", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("writes the name timeline as part of the submission store", async () => {
    await new StoreSubmissionNameHistoryTask().execute({ submission: renamed } as never, ctx);

    const rows = (await history(1277021)) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.name, r.valid_from, r.valid_to])).toEqual(
      expect.arrayContaining([
        ["JOSTENS HOLDING CORP", "2004-01-21T00:00:00.000Z", "2005-02-14T00:00:00.000Z"],
        ["VISANT HOLDING CORP", "2005-02-14T00:00:00.000Z", null],
      ])
    );
  });

  it("writes nothing for a company that never renamed", async () => {
    await new StoreSubmissionNameHistoryTask().execute(
      { submission: { cik: 320193, name: "Apple Inc.", sic: "3571", formerNames: [] } } as never,
      ctx
    );

    expect((await history(320193)) ?? []).toHaveLength(0);
  });

  it("is idempotent — re-ingesting the same submission upserts rather than duplicates", async () => {
    const task = new StoreSubmissionNameHistoryTask();
    await task.execute({ submission: renamed } as never, ctx);
    await task.execute({ submission: renamed } as never, ctx);

    expect((await history(1277021)) ?? []).toHaveLength(2);
  });

  it("unwraps the array form the fetch task can hand back", async () => {
    await new StoreSubmissionNameHistoryTask().execute({ submission: [renamed] } as never, ctx);

    expect((await history(1277021)) ?? []).toHaveLength(2);
  });
});
