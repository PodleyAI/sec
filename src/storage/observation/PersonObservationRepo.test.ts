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

  it("upsertByNaturalKey assigns distinct positive observation_ids", async () => {
    // observation_id is now backend-assigned (x-auto-generated). We don't
    // pin specific integer values because the contract is "distinct,
    // positive, monotonically allocated" — not "1, 2, 3" — and Postgres
    // SERIAL sequences in particular may skip values on rollback.
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
    expect(a.observation_id).toBeGreaterThan(0);

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
    expect(b.observation_id).toBeGreaterThan(0);
    expect(b.observation_id).not.toBe(a.observation_id);
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

  // The next two tests pin down the TOCTOU fix: concurrent inserts on
  // an empty store used to race because both observed `size()` as 0 and
  // assigned observation_id=1 to two different natural keys. The fix
  // is now driven by the storage backend's auto-generated key — the
  // tests verify distinct positive ids and row count.

  it("concurrent inserts on empty store get distinct positive ids", async () => {
    const [a, b] = await Promise.all([
      repo.upsertByNaturalKey({
        accession_number: "0001-25-000001",
        extractor_id: "D",
        extractor_version: "1.0.0",
        observation_index: 0,
        last_name: "Smith",
        normalized_last: "smith",
        created_at: "2026-05-22T00:00:00.000Z",
      }),
      repo.upsertByNaturalKey({
        accession_number: "0001-25-000001",
        extractor_id: "D",
        extractor_version: "1.0.0",
        observation_index: 1,
        last_name: "Jones",
        normalized_last: "jones",
        created_at: "2026-05-22T00:00:00.000Z",
      }),
    ]);
    expect(a.observation_id).toBeGreaterThan(0);
    expect(b.observation_id).toBeGreaterThan(0);
    expect(a.observation_id).not.toBe(b.observation_id);
    expect(await storage.size()).toBe(2);
  });

  it("concurrent update-of-existing keeps original id while parallel insert gets a new id", async () => {
    const seeded = await repo.upsertByNaturalKey({
      accession_number: "0001-25-000001",
      extractor_id: "D",
      extractor_version: "1.0.0",
      observation_index: 0,
      last_name: "Smith",
      normalized_last: "smith",
      created_at: "2026-05-22T00:00:00.000Z",
    });
    expect(seeded.observation_id).toBeGreaterThan(0);

    const [updated, inserted] = await Promise.all([
      repo.upsertByNaturalKey({
        accession_number: "0001-25-000001",
        extractor_id: "D",
        extractor_version: "1.1.0",
        observation_index: 0,
        last_name: "Smithy",
        normalized_last: "smithy",
        created_at: "2026-05-23T00:00:00.000Z",
      }),
      repo.upsertByNaturalKey({
        accession_number: "0001-25-000001",
        extractor_id: "D",
        extractor_version: "1.1.0",
        observation_index: 1,
        last_name: "Jones",
        normalized_last: "jones",
        created_at: "2026-05-23T00:00:00.000Z",
      }),
    ]);
    expect(updated.observation_id).toBe(seeded.observation_id);
    expect(updated.last_name).toBe("Smithy");
    expect(inserted.observation_id).toBeGreaterThan(0);
    expect(inserted.observation_id).not.toBe(seeded.observation_id);
    expect(await storage.size()).toBe(2);
  });
});
