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

  it("a later rename that does not chain does not leave a second current row", async () => {
    // CIK 1820372's real two-ingest sequence: the second ingest adds a rename,
    // which moves where the open interval starts. Without a reconcile the row
    // written at 2020-08-10 by ingest A stays behind, still `valid_to: null`.
    const task = new StoreSubmissionNameHistoryTask();
    await task.execute(
      {
        submission: {
          cik: 1820372,
          name: "FAIRWOOD SUSTAINABILITY, INC.",
          sic: "",
          formerNames: [
            {
              name: "JW Sustainable Solutions, Inc.",
              from: "2020-08-07T00:00:00.000Z",
              to: "2020-08-10T00:00:00.000Z",
            },
          ],
        },
      } as never,
      ctx
    );
    await task.execute(
      {
        submission: {
          cik: 1820372,
          name: "FAIRWOOD SUSTAINABILITY LLC",
          sic: "",
          formerNames: [
            {
              name: "JW Sustainable Solutions, Inc.",
              from: "2020-08-07T00:00:00.000Z",
              to: "2020-08-10T00:00:00.000Z",
            },
            {
              name: "FAIRWOOD SUSTAINABILITY, INC.",
              from: "2020-08-17T00:00:00.000Z",
              to: "2020-08-20T00:00:00.000Z",
            },
          ],
        },
      } as never,
      ctx
    );

    const rows = (await history(1820372)) ?? [];
    expect(rows.filter((r) => r.valid_to === null)).toHaveLength(1);
    expect(rows.map((r) => r.valid_from)).not.toContain("2020-08-10T00:00:00.000Z");
  });

  it("leaves rows written by another change source alone", async () => {
    // `entities_history` is shared: EntityTemporalRepo.saveEntityWithHistory
    // writes under its caller's own change_source. An unscoped reconcile would
    // delete those rows because they are not in the rebuilt set.
    const repo = globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN);
    await repo.put({
      cik: 1277021,
      valid_from: "2019-01-01T00:00:00.000Z",
      valid_to: null,
      name: "SOMETHING ELSE",
      type: null,
      sic: null,
      ein: null,
      description: null,
      website: null,
      investor_website: null,
      category: null,
      fiscal_year: null,
      state_incorporation: null,
      state_incorporation_desc: null,
      change_source: "ENTITY_UPDATE",
      change_date: "2019-01-01T00:00:00.000Z",
    });

    await new StoreSubmissionNameHistoryTask().execute({ submission: renamed } as never, ctx);

    const rows = (await history(1277021)) ?? [];
    const survivor = rows.find((r) => r.change_source === "ENTITY_UPDATE");
    expect(survivor).toBeDefined();
    expect(survivor?.name).toBe("SOMETHING ELSE");
  });
});
