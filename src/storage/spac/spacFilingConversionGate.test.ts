/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `spac` gate itself, apart from the sweep that applies it.
 *
 * The Postgres fragment has no database of its own in this suite — the sweep's
 * coverage is the repository path and SQLite — so the one thing that keeps the
 * three routes saying the same thing is that they are built from this one
 * object. Reading its fragment in both dialects is what that claim costs.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { minimalSpac } from "../../config/testing/minimalSpac";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import {
  clearFilingConversionGateForTesting,
  filingConversionGate,
  type FilingConversionGate,
} from "../../task/document/filingConversionGate";
import { SPAC_REPOSITORY_TOKEN } from "./SpacSchema";
import { registerSpacFilingConversionGate } from "./spacFilingConversionGate";

function registeredGate(): FilingConversionGate {
  registerSpacFilingConversionGate();
  const gate = filingConversionGate();
  if (gate === undefined) throw new Error("registration did not reach the seam");
  return gate;
}

describe("spac filing conversion gate", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).setupDatabase();
  });

  afterEach(() => {
    registerSpacFilingConversionGate();
    resetDependencyInjectionsForTesting();
  });

  it("registers itself into the seam the sweep reads", () => {
    clearFilingConversionGateForTesting();
    expect(filingConversionGate()).toBeUndefined();
    registerSpacFilingConversionGate();
    expect(filingConversionGate()).toBeDefined();
  });

  it("admits the origin CIK and the surviving one", async () => {
    const spacs = globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN);
    await spacs.put(minimalSpac(1811882, { current_cik: 320193 }));
    await spacs.put(minimalSpac(1083743));
    const admitted = await registeredGate().admittedCiks();
    expect([...admitted].sort((a, b) => a - b)).toEqual([320193, 1083743, 1811882]);
  });

  it("pushes the same correlated EXISTS into either dialect", () => {
    const pushdown = registeredGate().pushdown();
    if (pushdown === undefined) throw new Error("a bound spac storage should push down");
    const sqlite = pushdown.fragment({
      backend: "sqlite",
      filingAlias: "f",
      firstParamIndex: 4,
    });
    const postgres = pushdown.fragment({
      backend: "postgres",
      filingAlias: "f",
      firstParamIndex: 4,
    });
    expect(sqlite.sql).toBe(
      "EXISTS (SELECT 1 FROM `spac` s WHERE s.`cik` = f.`cik` OR s.`current_cik` = f.`cik`)"
    );
    expect(postgres.sql).toBe(
      'EXISTS (SELECT 1 FROM "spac" s WHERE s."cik" = f."cik" OR s."current_cik" = f."cik")'
    );
    // No parameters, so neither branch of the sweep has a placeholder to number
    // and `firstParamIndex` goes unread.
    expect(sqlite.params).toEqual([]);
    expect(postgres.params).toEqual([]);
  });
});
