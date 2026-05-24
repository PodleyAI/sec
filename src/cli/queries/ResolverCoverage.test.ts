/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { PersonIdentityLinkRepo } from "../../storage/canonical/PersonIdentityLinkRepo";
import { computeResolverCoverage } from "./ResolverCoverage";

describe("computeResolverCoverage", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("returns correct coverage fractions for person resolver", async () => {
    const obsRepo = new PersonObservationRepo();
    const linkRepo = new PersonIdentityLinkRepo();

    // Seed 3 PersonObservation rows
    const obs1 = await obsRepo.upsertByNaturalKey({
      accession_number: "0001000000-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const obs2 = await obsRepo.upsertByNaturalKey({
      accession_number: "0001000000-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const obs3 = await obsRepo.upsertByNaturalKey({
      accession_number: "0001000000-25-000003",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      created_at: "2026-05-22T00:00:00.000Z",
    });

    // Seed 2 PersonIdentityLink rows at resolver_version "1.0.0"
    await linkRepo.upsert(obs1.observation_id, "1.0.0", "canonical-person-1");
    await linkRepo.upsert(obs2.observation_id, "1.0.0", "canonical-person-2");

    // Seed 1 PersonIdentityLink row at resolver_version "2.0.0"
    await linkRepo.upsert(obs3.observation_id, "2.0.0", "canonical-person-3");

    const result100 = await computeResolverCoverage("person", "1.0.0");
    expect(result100.numerator).toBe(2);
    expect(result100.denominator).toBe(3);
    expect(result100.fraction).toBeCloseTo(2 / 3);

    const result200 = await computeResolverCoverage("person", "2.0.0");
    expect(result200.numerator).toBe(1);
    expect(result200.denominator).toBe(3);
    expect(result200.fraction).toBeCloseTo(1 / 3);
  });

  it("returns zero coverage for company when no observations exist", async () => {
    const result = await computeResolverCoverage("company", "1.0.0");
    expect(result.numerator).toBe(0);
    expect(result.denominator).toBe(0);
    expect(result.fraction).toBe(0);
  });
});
