/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import type { CompanyFact } from "../facts/CompanyFactsSchema";
import { isNewerTrustSnapshot, pickLatestTrustFact } from "./pickLatestTrustFact";

function fact(over: Partial<CompanyFact> = {}): CompanyFact {
  return {
    cik: 1,
    grouping: "us-gaap",
    name: "AssetsHeldInTrust",
    filed_date: "2024-05-15",
    form: "10-Q",
    val_unit: "USD",
    frame: "CY2024Q1",
    accession_number: "0001-24-001",
    start_date: null,
    end_date: "2024-03-31",
    val: 201_000_000,
    fy: 2024,
    fp: "Q1",
    ...over,
  };
}

describe("pickLatestTrustFact", () => {
  it("returns null when no trust facts exist", () => {
    expect(pickLatestTrustFact([fact({ name: "Assets" })])).toBeNull();
  });

  it("picks AssetsHeldInTrust from a 10-Q", () => {
    const f = fact();
    expect(pickLatestTrustFact([f])).toEqual(f);
  });

  it("ignores registration and 8-K facts", () => {
    expect(
      pickLatestTrustFact([
        fact({ form: "S-1", val: 200_000_000, end_date: "2024-06-30" }),
        fact({ form: "8-K", val: 210_000_000, end_date: "2024-06-30" }),
      ])
    ).toBeNull();
  });

  it("prefers the later period end", () => {
    const q1 = fact({ end_date: "2024-03-31", val: 201_000_000, accession_number: "q1" });
    const q2 = fact({
      end_date: "2024-06-30",
      val: 204_000_000,
      accession_number: "q2",
      filed_date: "2024-08-14",
      fp: "Q2",
    });
    expect(pickLatestTrustFact([q1, q2])?.val).toBe(204_000_000);
  });

  it("prefers a later-filed amendment of the same period", () => {
    const orig = fact({ filed_date: "2024-05-15", val: 201_000_000, accession_number: "orig" });
    const amd = fact({
      form: "10-Q/A",
      filed_date: "2024-06-01",
      val: 201_500_000,
      accession_number: "amd",
    });
    expect(pickLatestTrustFact([amd, orig])?.val).toBe(201_500_000);
  });

  it("prefers the spac taxonomy over us-gaap for the same period", () => {
    const gaap = fact({ grouping: "us-gaap", val: 200_000_000 });
    const spac = fact({
      grouping: "spac",
      name: "AssetsHeldInTrustNoncurrent",
      val: 201_000_000,
      accession_number: "s",
    });
    expect(pickLatestTrustFact([gaap, spac])?.grouping).toBe("spac");
  });

  it("prefers the unqualified AssetsHeldInTrust name over Noncurrent when both exist", () => {
    const total = fact({ name: "AssetsHeldInTrust", val: 201_000_000 });
    const nc = fact({
      name: "AssetsHeldInTrustNoncurrent",
      val: 201_000_000,
      accession_number: "nc",
    });
    expect(pickLatestTrustFact([nc, total])?.name).toBe("AssetsHeldInTrust");
  });

  it("accepts AssetsHeldInTrustNoncurrent when that is the only tag", () => {
    expect(pickLatestTrustFact([fact({ name: "AssetsHeldInTrustNoncurrent" })])?.name).toBe(
      "AssetsHeldInTrustNoncurrent"
    );
  });

  it("ignores non-positive values and facts without a period end", () => {
    expect(pickLatestTrustFact([fact({ val: 0 })])).toBeNull();
    expect(pickLatestTrustFact([fact({ end_date: null, val: 201_000_000 })])).toBeNull();
  });
});

describe("isNewerTrustSnapshot", () => {
  it("applies when the row has no current trust yet", () => {
    expect(
      isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-05-15" }, { asOf: null, filed: null })
    ).toBe(true);
  });

  it("applies a later quarter and rejects an older one", () => {
    const existing = { asOf: "2024-03-31", filed: "2024-05-15" };
    expect(isNewerTrustSnapshot({ asOf: "2024-06-30", filed: "2024-08-14" }, existing)).toBe(true);
    expect(isNewerTrustSnapshot({ asOf: "2023-12-31", filed: "2024-03-01" }, existing)).toBe(false);
  });

  it("applies a same-period restatement filed later", () => {
    const existing = { asOf: "2024-03-31", filed: "2024-05-15" };
    expect(isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-06-01" }, existing)).toBe(true);
    expect(isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-05-15" }, existing)).toBe(false);
    expect(isNewerTrustSnapshot({ asOf: "2024-03-31", filed: "2024-05-01" }, existing)).toBe(false);
  });
});
