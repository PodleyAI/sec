/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { IssuerTickerRepo } from "./IssuerTickerRepo";

describe("IssuerTickerRepo", () => {
  beforeEach(() => resetDependencyInjectionsForTesting());

  it("stores exact symbols and returns a CIK history ordered by filing date", async () => {
    const repo = new IssuerTickerRepo();
    const base = {
      extractor_id: "S-1",
      cik: 1848507,
      security_type: null,
      is_primary: true,
      confidence: null,
      source_span: null,
      created_at: new Date().toISOString(),
    };
    await repo.save({
      ...base,
      accession_number: "0000000000-26-000002",
      exchange: "NASDAQ",
      ticker: "ACQU",
      filing_date: "2026-01-02",
    });
    await repo.save({
      ...base,
      accession_number: "0000000000-26-000009",
      exchange: "NASDAQ",
      ticker: "ACQ",
      filing_date: "2026-06-01",
    });
    const history = await repo.history(1848507);
    expect(history.map((t) => t.ticker)).toEqual(["ACQU", "ACQ"]);
  });

  it("clears all ticker rows for an accession", async () => {
    const repo = new IssuerTickerRepo();
    await repo.save({
      extractor_id: "S-1",
      accession_number: "0000000000-26-000002",
      exchange: "NASDAQ",
      ticker: "ACQU",
      cik: 1848507,
      filing_date: "2026-01-02",
      security_type: "Units",
      is_primary: true,
      confidence: null,
      source_span: null,
      created_at: new Date().toISOString(),
    });
    await repo.clear("0000000000-26-000002");
    expect(await repo.history(1848507)).toHaveLength(0);
  });

  it("orders same-filing-date symbols deterministically (primary first, then ticker)", async () => {
    const repo = new IssuerTickerRepo();
    const base = {
      extractor_id: "S-1",
      accession_number: "0000000000-26-000002",
      cik: 1848507,
      filing_date: "2026-01-02",
      security_type: null,
      confidence: null,
      source_span: null,
      created_at: new Date().toISOString(),
    };
    // Insert non-primary symbols first to prove ordering is not insertion order.
    await repo.save({ ...base, exchange: "NASDAQ", ticker: "ACQW", is_primary: false });
    await repo.save({ ...base, exchange: "NASDAQ", ticker: "ACQ", is_primary: false });
    await repo.save({ ...base, exchange: "NASDAQ", ticker: "ACQU", is_primary: true });
    const history = await repo.history(1848507);
    expect(history.map((t) => t.ticker)).toEqual(["ACQU", "ACQ", "ACQW"]);
  });
});
