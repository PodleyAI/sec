/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { PersonObservationRepo } from "./PersonObservationRepo";
import {
  PersonObservationPrimaryKeyNames,
  PersonObservationSchema,
  type PersonObservation,
} from "./PersonObservationSchema";

describe("PersonObservationRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof PersonObservationSchema,
    typeof PersonObservationPrimaryKeyNames,
    PersonObservation
  >;
  let repo: PersonObservationRepo;

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof PersonObservationSchema,
      typeof PersonObservationPrimaryKeyNames,
      PersonObservation
    >(PersonObservationSchema, PersonObservationPrimaryKeyNames, [
      ["accession_number"],
      ["accession_number", "extractor_id", "observation_index"],
    ]);
    repo = new PersonObservationRepo({ personObservationRepository: storage });
  });

  it("upsertByNaturalKey assigns sequential observation_ids", async () => {
    const a = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      source_filing_issuer_cik: 1234,
      last_name: "Smith",
      normalized_last: "smith",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(a.observation_id).toBe(1);

    const b = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 1,
      source_filing_issuer_cik: 1234,
      last_name: "Jones",
      normalized_last: "jones",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(b.observation_id).toBe(2);
  });

  it("upsertByNaturalKey overwrites same natural key in place across extractor versions", async () => {
    const first = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Smith",
      normalized_last: "smith",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const second = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "2.0.0",
      observation_index: 0,
      last_name: "Smithy",
      normalized_last: "smithy",
      created_at: "2026-05-23T00:00:00.000Z",
    });
    expect(second.observation_id).toBe(first.observation_id);
    expect(second.extractor_version).toBe("2.0.0");
    expect(second.last_name).toBe("Smithy");
    expect(await storage.size()).toBe(1);
  });

  it("listByAccession returns rows ordered by observation_index", async () => {
    await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 1,
      last_name: "B",
      normalized_last: "b",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "A",
      normalized_last: "a",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const rows = await repo.listByAccession("0001-25-000001");
    expect(rows.map((r) => r.observation_index)).toEqual([0, 1]);
  });

  it("getByNaturalKey returns the row when present and undefined otherwise", async () => {
    await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Smith",
      normalized_last: "smith",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const found = await repo.getByNaturalKey("0001-25-000001", "D", 0);
    expect(found?.last_name).toBe("Smith");
    const missing = await repo.getByNaturalKey("nonexistent", "D", 0);
    expect(missing).toBeUndefined();
  });

  it("getById returns the row by observation_id", async () => {
    const row = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Smith",
      normalized_last: "smith",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const found = await repo.getById(row.observation_id);
    expect(found?.observation_id).toBe(row.observation_id);
  });
});
