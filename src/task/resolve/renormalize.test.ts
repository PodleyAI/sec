/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { CompanyObservationRepo } from "../../storage/observation/CompanyObservationRepo";
import { PersonObservationRepo } from "../../storage/observation/PersonObservationRepo";
import { ResolveObservationsTask } from "./ResolveObservationsTask";

async function run(kind: "person" | "company", renormalize: boolean) {
  return new ResolveObservationsTask({
    defaults: { kind, resolverVersion: "1.0.0", renormalize },
  }).run();
}

describe("ResolveObservationsTask --renormalize", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("recomputes a company's normalized_name from the name as filed", async () => {
    const repo = new CompanyObservationRepo();
    const row = await repo.upsertByNaturalKey({
      accession_number: "0000000000-26-000001",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Blue Acquisition Corp/Cayman",
      // A stale value, as an earlier normalizer generation would have left it.
      normalized_name: "Blue Acquisition Corp/Cayman",
    } as never);
    expect(row.normalized_name).toBe("Blue Acquisition Corp/Cayman");

    const out = await run("company", true);
    expect(out.renormalized).toBe(1);
    const after = await repo.getById(row.observation_id);
    expect(after?.normalized_name).toBe("Blue Acquisition");
    // The name as filed is untouched — only the derived column moves.
    expect(after?.name).toBe("Blue Acquisition Corp/Cayman");
  });

  it("leaves the derived columns alone without the flag", async () => {
    const repo = new CompanyObservationRepo();
    const row = await repo.upsertByNaturalKey({
      accession_number: "0000000000-26-000002",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Blue Acquisition Corp/Cayman",
      normalized_name: "Blue Acquisition Corp/Cayman",
    } as never);

    const out = await run("company", false);
    expect(out.renormalized).toBe(0);
    expect((await repo.getById(row.observation_id))?.normalized_name).toBe(
      "Blue Acquisition Corp/Cayman"
    );
  });

  it("recomputes a person's identity parts and reports only what changed", async () => {
    const repo = new PersonObservationRepo();
    const stale = await repo.upsertByNaturalKey({
      accession_number: "0000000000-26-000003",
      extractor_id: "4",
      extractor_version: "1.0.0",
      observation_index: 0,
      first_name: "Jane",
      last_name: "Smith",
      normalized_first: "wrong",
      normalized_last: "wrong",
    } as never);

    const first = await run("person", true);
    expect(first.renormalized).toBe(1);
    const after = await repo.getById(stale.observation_id);
    expect(after?.normalized_first).toBe("Jane");
    expect(after?.normalized_last).toBe("Smith");

    // Idempotent: a second pass finds nothing to change.
    expect((await run("person", true)).renormalized).toBe(0);
  });
});
