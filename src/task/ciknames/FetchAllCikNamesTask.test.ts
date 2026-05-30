/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { SEC_DB_TYPE } from "../../config/tokens";
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
    // Pin SEC_DB_TYPE to a value that is neither "sqlite" nor "postgres" so
    // createCikNameBulkWriter() deterministically selects the in-memory
    // repository writer. bun shares module state across test files in a
    // worker, and sibling task tests (FetchDailyIndexTask/
    // FetchQuarterlyIndexTask) call EnvToDI() at module load, which
    // registers SEC_DB_FOLDER / SEC_DB_NAME / SEC_DB_TYPE=sqlite from
    // .env.test into the shared registry. The registry has no unregister
    // API, so without this pin a leaked sqlite config would route the
    // writer down the getDb() fast path and prepare an INSERT against a
    // cik_names table that does not exist in the test SQLite file.
    //
    // "memory" is intentionally OUTSIDE the token's declared
    // "sqlite" | "postgres" union: at runtime it is the sentinel that makes
    // createCikNameBulkWriter() fall through to the repository writer, but
    // the type only admits the two real backends, so we cast through
    // `unknown` to register the out-of-union sentinel.
    globalServiceRegistry.registerInstance(
      SEC_DB_TYPE,
      "memory" as unknown as "sqlite" | "postgres"
    );
  });

  it("falls back to the repository writer when no real DB is configured", async () => {
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

  it("dedups duplicate CIKs within a single batch, last value wins", async () => {
    const writer = createCikNameBulkWriter();
    await writer.writeBatch([
      { cik: 1, name: "FIRST" },
      { cik: 2, name: "B" },
      { cik: 1, name: "LAST" },
    ]);
    await writer.close();
    const repo = globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN);
    expect((await repo.get({ cik: 1 }))?.name).toBe("LAST");
    const all = await repo.getAll();
    expect(all?.length).toBe(2);
  });
});
