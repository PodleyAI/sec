/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CompanyObservationRepo } from "./CompanyObservationRepo";
import {
  CompanyObservationPrimaryKeyNames,
  CompanyObservationSchema,
  type CompanyObservation,
} from "./CompanyObservationSchema";

describe("CompanyObservationRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof CompanyObservationSchema,
    typeof CompanyObservationPrimaryKeyNames,
    CompanyObservation
  >;
  let repo: CompanyObservationRepo;

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CompanyObservationSchema,
      typeof CompanyObservationPrimaryKeyNames,
      CompanyObservation
    >(CompanyObservationSchema, CompanyObservationPrimaryKeyNames, [
      ["accession_number"],
      ["accession_number", "extractor_id", "observation_index"],
    ]);
    repo = new CompanyObservationRepo({ companyObservationRepository: storage });
  });

  it("upsertByNaturalKey assigns sequential observation_ids", async () => {
    const a = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Acme Holdings",
      normalized_name: "acme holdings",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(a.observation_id).toBe(1);

    const b = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 1,
      cik: 1234567,
      name: "Beta Co LLC",
      normalized_name: "beta co llc",
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
      name: "Acme Holdings",
      normalized_name: "acme holdings",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const second = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "2.0.0",
      observation_index: 0,
      name: "Acme Holdings LLC",
      normalized_name: "acme holdings llc",
      created_at: "2026-05-23T00:00:00.000Z",
    });
    expect(second.observation_id).toBe(first.observation_id);
    expect(second.extractor_version).toBe("2.0.0");
    expect(second.name).toBe("Acme Holdings LLC");
    expect(await storage.size()).toBe(1);
  });

  it("listByAccession returns rows ordered by observation_index", async () => {
    await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 2,
      name: "C",
      normalized_name: "c",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "A",
      normalized_name: "a",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const rows = await repo.listByAccession("0001-25-000001");
    expect(rows.map((r) => r.observation_index)).toEqual([0, 2]);
  });

  it("getByNaturalKey returns row when present, undefined when missing", async () => {
    await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Acme",
      normalized_name: "acme",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const found = await repo.getByNaturalKey("0001-25-000001", "D", 0);
    expect(found?.name).toBe("Acme");
    const missing = await repo.getByNaturalKey("nope", "D", 0);
    expect(missing).toBeUndefined();
  });

  it("getById returns row by observation_id", async () => {
    const row = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      name: "Acme",
      normalized_name: "acme",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    const found = await repo.getById(row.observation_id);
    expect(found?.observation_id).toBe(row.observation_id);
  });
});
