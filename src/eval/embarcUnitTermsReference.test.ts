/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _resetEmbarcUnitTermsCacheForTesting,
  cikFromFilingName,
  embarcExpectedRow,
  loadEmbarcUnitTermsReference,
} from "./embarcUnitTermsReference";
import { roundUnitFields } from "./runUnitTermsEval";

describe("embarc unit-terms reference dataset", () => {
  it("loads the full curated set keyed by CIK", () => {
    const ref = loadEmbarcUnitTermsReference();
    expect(ref.size).toBeGreaterThan(1200);
  });

  it("carries parsed decimals alongside the curated fraction text", () => {
    const cenaq = loadEmbarcUnitTermsReference().get(1841425)!;
    expect(cenaq.name).toBe("CENAQ Energy Corp.");
    expect(cenaq.unit_price).toBe(10);
    expect(cenaq.unit_warrant).toBe("3/4");
    expect(cenaq.warrant_fraction_per_unit).toBeCloseTo(0.75);
    expect(cenaq.warrant_price).toBe(11.5);
    expect(cenaq.right_fraction_per_unit).toBeNull();
  });

  it("covers the committed 2021-era SPAC S-1 fixtures with distinct warrant fractions", () => {
    const ref = loadEmbarcUnitTermsReference();
    expect(ref.get(1849470)?.warrant_fraction_per_unit).toBeCloseTo(1 / 3);
    expect(ref.get(1848507)?.warrant_fraction_per_unit).toBeCloseTo(1 / 4);
    expect(ref.get(1822912)?.warrant_fraction_per_unit).toBeCloseTo(1 / 2);
  });

  it("represents rights-bearing units (rights per unit + share conversion)", () => {
    const ref = loadEmbarcUnitTermsReference();
    const withRights = [...ref.values()].filter((r) => r.right_fraction_per_unit != null);
    expect(withRights.length).toBeGreaterThan(100);
    for (const r of withRights.slice(0, 5)) {
      expect(r.right_fraction_per_unit).toBe(1);
      expect(r.right_share_conversion).toBeGreaterThan(0);
      expect(r.right_share_conversion).toBeLessThanOrEqual(1);
    }
  });

  it("embarcExpectedRow carries only reference-known fields", () => {
    const ref = loadEmbarcUnitTermsReference().get(1841425)!;
    // CENAQ has no rights, so the expected row must not score that field.
    expect(embarcExpectedRow(ref)).toEqual({
      price_per_unit: 10,
      warrant_fraction_per_unit: 0.75,
    });
  });

  it("cikFromFilingName parses fixture filenames", () => {
    expect(cikFromFilingName("s1_1849470_000110465921035696")).toBe(1849470);
    expect(cikFromFilingName("not-a-fixture")).toBeNull();
  });

  it("roundUnitFields rounds the scored numerics to 2 decimals (both sides of the score)", () => {
    expect(
      roundUnitFields({
        price_per_unit: 10.0,
        warrant_fraction_per_unit: 1 / 3,
        right_fraction_per_unit: 0.1,
        unit_composition: "one share and one-third of one warrant",
      })
    ).toEqual({
      price_per_unit: 10,
      warrant_fraction_per_unit: 0.33,
      right_fraction_per_unit: 0.1,
      unit_composition: "one share and one-third of one warrant",
    });
  });
});

describe("SEC_UNIT_TERMS_REF override", () => {
  const CSV_HEADER =
    "cik,name,unit_common,unit_price,unit_warrant," +
    "warrant_fraction_per_unit,right_fraction_per_unit," +
    "right_share_conversion,warrant_ratio,warrant_price";
  const originalEnv = process.env.SEC_UNIT_TERMS_REF;
  let tmpDir: string;

  beforeEach(() => {
    _resetEmbarcUnitTermsCacheForTesting();
    tmpDir = mkdtempSync(join(tmpdir(), "sec-unit-terms-ref-"));
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.SEC_UNIT_TERMS_REF;
    else process.env.SEC_UNIT_TERMS_REF = originalEnv;
    _resetEmbarcUnitTermsCacheForTesting();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("env set + file exists → loads from the override path", () => {
    const csvPath = join(tmpDir, "override.csv");
    writeFileSync(
      csvPath,
      `${CSV_HEADER}\n` + `9999999,Override SPAC Corp.,1,10,1/2,0.5,,,,11.5\n`,
      "utf8"
    );
    process.env.SEC_UNIT_TERMS_REF = csvPath;

    const ref = loadEmbarcUnitTermsReference();
    expect(ref.size).toBe(1);
    const row = ref.get(9999999)!;
    expect(row.name).toBe("Override SPAC Corp.");
    expect(row.unit_price).toBe(10);
    expect(row.warrant_fraction_per_unit).toBeCloseTo(0.5);
  });

  it("env set + file missing → throws naming the env var and the path (no silent fallback)", () => {
    const missingPath = join(tmpDir, "does-not-exist.csv");
    process.env.SEC_UNIT_TERMS_REF = missingPath;

    expect(() => loadEmbarcUnitTermsReference()).toThrow(
      /SEC_UNIT_TERMS_REF.*does not exist/
    );
  });

  it("env unset → falls back to the package-shipped fixture", () => {
    delete process.env.SEC_UNIT_TERMS_REF;

    const ref = loadEmbarcUnitTermsReference();
    expect(ref.size).toBeGreaterThan(1200);
  });
});
