/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_FOLDER } from "../../config/tokens";
import {
  createCikNameBulkWriter,
  type CikNameRow,
} from "../../storage/entity/cikNameBulkWriter";
import {
  CIK_NAME_REPOSITORY_TOKEN,
  type CikNameType,
} from "../../storage/entity/CikNameSchema";

// FetchAllCikNamesTask's end-to-end path runs through the SEC job queue and
// is exercised by manual + integration tests; these unit tests pin the bulk
// writer behaviour that is the regression-prone surface (the previous
// implementation reached into getDb() unconditionally and silently wrote to
// SQLite under SEC_DB_TYPE=postgres).

describe("createCikNameBulkWriter", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("falls back to the repository writer when no real DB is configured", async () => {
    // SEC_DB_TYPE may be left as "sqlite" by a sibling test that called
    // EnvToDI() at module-load time. Without SEC_DB_FOLDER the SQLite fast
    // path can't run (getDb() would throw), so the writer must route
    // through the in-memory repository.
    expect(globalServiceRegistry.has(SEC_DB_FOLDER)).toBe(false);

    const writer = createCikNameBulkWriter();
    const rows: CikNameRow[] = [
      { cik: 320193, name: "APPLE INC" },
      { cik: 789019, name: "MICROSOFT CORP" },
      { cik: 1652044, name: "ALPHABET INC" },
    ];
    await writer.writeBatch(rows);
    await writer.close();

    const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
    const apple = await repo.get({ cik: 320193 });
    expect(apple?.name).toBe("APPLE INC");
    const all = ((await repo.getAll()) ?? []) as CikNameType[];
    expect(all.length).toBe(3);
  });

  it("overwrites existing rows by primary key on subsequent batches", async () => {
    const writer = createCikNameBulkWriter();
    await writer.writeBatch([{ cik: 320193, name: "OLD NAME" }]);
    await writer.writeBatch([{ cik: 320193, name: "APPLE INC" }]);
    await writer.close();
    const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
    const row = await repo.get({ cik: 320193 });
    expect(row?.name).toBe("APPLE INC");
  });

  it("handles an empty batch without error", async () => {
    const writer = createCikNameBulkWriter();
    await writer.writeBatch([]);
    await writer.close();
    const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
    expect((await repo.getAll())?.length ?? 0).toBe(0);
  });
});
