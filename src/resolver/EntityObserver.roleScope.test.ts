/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { buildObserveOnlyEntityObserver } from "./buildObserveOnlyEntityObserver";

const V = "1.0.0";

function observer() {
  return buildObserveOnlyEntityObserver();
}

describe("EntityObserver.observePerson role_scope round-trip", () => {
  beforeEach(() => {
    resetDependencyInjectionsForTesting();
  });

  it("persists the claim's role_scope onto the observation row", async () => {
    const obs = observer();
    const personObs = new PersonObservationRepo();

    const { observation_id } = await obs.observePerson({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Smith",
      role_scope: "form-d:related-person",
    });

    const row = await personObs.getById(observation_id);
    expect(row?.role_scope).toBe("form-d:related-person");
  });

  it("stores null when the claim carries no role_scope", async () => {
    const obs = observer();
    const personObs = new PersonObservationRepo();

    const { observation_id } = await obs.observePerson({
      accession_number: "0001-25-000002",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Jones",
    });

    const row = await personObs.getById(observation_id);
    expect(row?.role_scope).toBeNull();
  });
});
