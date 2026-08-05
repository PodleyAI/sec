/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Guards the committed `master.idx` fixtures.
 *
 * The quarterly fixtures are trimmed slices of real EDGAR quarters
 * (`scripts/trimIndexFixtures.ts`) rather than whole 30 MB files, so the
 * properties the index tasks depend on have to be asserted somewhere. They
 * cannot be asserted by `FetchDailyIndexTask.test.ts` /
 * `FetchQuarterlyIndexTask.test.ts`: those drive a live `JobQueueServer` and are
 * skipped under Node/vitest (and under CI) entirely.
 *
 * This test re-implements only the task's *parsing* preamble — slice at the
 * `-----` separator, then csv-parse on `|` — so it stays hermetic and runs
 * everywhere, while still failing if a re-trim produces a fixture the real tasks
 * could not parse.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "csv-parse/sync";
import { describe, expect, it } from "vitest";
import { secDate } from "../../util/parseDate";

const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");
const MOCK_DIR = join(importMetaDir, "mock_data");

/** Both index tasks assert `updateList.length > 100` distinct CIKs. */
const MIN_DISTINCT_CIKS = 100;
/** Both tasks' test doubles treat a sub-1 KB fixture as a simulated 403 body. */
const ERROR_FIXTURE_MAX_BYTES = 1000;

const files = readdirSync(MOCK_DIR).filter((n) => n.endsWith(".master.idx"));
const quarterly = files.filter((n) => /^\d{4}-QTR\d\.master\.idx$/.test(n));
const daily = files.filter((n) => /^\d{4}-\d{2}-\d{2}\.master\.idx$/.test(n));

/** Mirrors the slice-then-parse preamble shared by both index tasks. */
function parseFixture(name: string): string[][] {
  const content = readFileSync(join(MOCK_DIR, name), "utf-8");
  let loc = content.indexOf("-------");
  loc = content.indexOf("\n", loc + 1);
  return parse(content.slice(loc), {
    delimiter: "|",
    relax_column_count: false,
    quote: "¬",
    skip_empty_lines: true,
    skip_records_with_error: true,
  }) as string[][];
}

const isErrorFixture = (name: string): boolean =>
  statSync(join(MOCK_DIR, name)).size < ERROR_FIXTURE_MAX_BYTES;

describe("committed master.idx fixtures", () => {
  it("has both quarterly and daily fixtures to exercise", () => {
    expect(quarterly.length).toBeGreaterThan(0);
    expect(daily.length).toBeGreaterThan(0);
  });

  // The 403 fixture is identified purely by being small, so a future re-trim
  // that pushed a real index under the threshold would silently turn a
  // success-path test into an error-path one.
  it.each(files.filter((f) => !isErrorFixture(f)))(
    "%s stays above the error-fixture size threshold",
    (name) => {
      expect(statSync(join(MOCK_DIR, name)).size).toBeGreaterThanOrEqual(ERROR_FIXTURE_MAX_BYTES);
    }
  );

  it.each(files.filter(isErrorFixture))("%s is a simulated EDGAR error body", (name) => {
    expect(readFileSync(join(MOCK_DIR, name), "utf-8")).toMatch(/<Error>|AccessDenied/);
  });

  describe.each(files.filter((f) => !isErrorFixture(f)))("%s", (name) => {
    it("parses into uniform 5-column rows", () => {
      const records = parseFixture(name);
      expect(records.length).toBeGreaterThan(0);
      expect(new Set(records.map((r) => r.length))).toEqual(new Set([5]));
    });

    it(`yields more than ${MIN_DISTINCT_CIKS} distinct CIKs`, () => {
      const ciks = new Set(parseFixture(name).map((r) => parseInt(r[0])));
      expect(ciks.size).toBeGreaterThan(MIN_DISTINCT_CIKS);
      expect([...ciks].every((c) => Number.isFinite(c) && c > 0)).toBe(true);
    });
  });

  describe.each(quarterly)("%s", (name) => {
    it("carries dates the quarterly task can parse", () => {
      const dates = parseFixture(name).map((r) => r[3]);
      expect(dates.length).toBeGreaterThan(0);
      for (const d of dates) expect(() => secDate(d)).not.toThrow();
    });

    // The quarterly task keeps the latest filing date per CIK, so a slice where
    // every CIK appeared once would leave that branch unexercised.
    it("repeats CIKs across rows so the latest-date-wins dedupe is exercised", () => {
      const ciks = parseFixture(name).map((r) => r[0]);
      expect(ciks.length - new Set(ciks).size).toBeGreaterThan(0);
    });

    it("spans a range of filing dates rather than a single day", () => {
      const dates = [...new Set(parseFixture(name).map((r) => r[3]))].sort();
      expect(dates.length).toBeGreaterThan(1);
      expect(dates[0]).not.toEqual(dates[dates.length - 1]);
    });
  });
});
