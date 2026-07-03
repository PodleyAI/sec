/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import type { IExecuteContext } from "workglow";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import type { Filings } from "../../sec/submissions/EnititySubmissionSchema";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import { StoreSubmissionFilingsTask } from "./StoreSubmissionFilingsTask";

const ctx = {
  signal: new AbortController().signal,
  updateProgress: () => {},
} as unknown as IExecuteContext;

/**
 * Builds a `Filings` object-of-arrays (the EDGAR submissions shape) with one
 * "column" entry per filing.
 */
function makeFilings(accessions: readonly string[]): Filings {
  const n = accessions.length;
  const fill = <T>(v: T): T[] => Array.from({ length: n }, () => v);
  return {
    accessionNumber: [...accessions],
    filingDate: fill("2026-01-01"),
    reportDate: fill("2025-12-31"),
    acceptanceDateTime: fill("2026-01-01T12:00:00.000Z"),
    act: fill("34"),
    form: accessions.map((_, i) => (i % 2 === 0 ? "4" : "8-K")),
    filmNumber: fill("111"),
    fileNumber: fill("000-1"),
    items: fill(""),
    size: fill(1234),
    isXBRL: fill(false),
    isInlineXBRL: fill(false),
    primaryDocument: accessions.map((a) => `${a}.xml`),
    primaryDocDescription: fill("DOC"),
  };
}

describe("StoreSubmissionFilingsTask", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("stores every filing as a concrete row (regression: proxy slice must not yield undefined)", async () => {
    const cik = 1018724;
    const accessions = ["0000000000-26-000001", "0000000000-26-000002", "0000000000-26-000003"];
    const submission = { cik } as never;
    const filings = makeFilings(accessions);

    await new StoreSubmissionFilingsTask().execute({ submission, filings }, ctx);

    const stored = await new EntityRepo().getFilings(cik);
    expect(stored).toHaveLength(accessions.length);
    // The proxy's `slice` returned sparse holes before the fix, which spread to
    // `undefined` rows in `putBulk`. Assert no row is undefined and the mapped
    // fields survived.
    for (const row of stored) {
      expect(row).toBeDefined();
      expect(row.cik).toBe(cik);
    }
    expect(new Set(stored.map((r) => r.accession_number))).toEqual(new Set(accessions));
    expect(new Set(stored.map((r) => r.form))).toEqual(new Set(["4", "8-K"]));
  });
});
