/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalPersonPhonePrimaryKeyNames,
  CanonicalPersonPhoneSchema,
  type CanonicalPersonPhone,
} from "./CanonicalJunctionSchemas";
import { CanonicalPersonPhoneRepo } from "./CanonicalPersonPhoneRepo";

describe("CanonicalPersonPhoneRepo.removeObservation", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalPersonPhoneSchema,
    typeof CanonicalPersonPhonePrimaryKeyNames,
    CanonicalPersonPhone
  >;
  let repo: CanonicalPersonPhoneRepo;
  const pk = {
    canonical_person_id: "uuid-1",
    international_number: "+14155551234",
    resolver_version: "1.0.0",
  };

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalPersonPhoneSchema,
      typeof CanonicalPersonPhonePrimaryKeyNames,
      CanonicalPersonPhone
    >(CanonicalPersonPhoneSchema, CanonicalPersonPhonePrimaryKeyNames, [
      ["canonical_person_id", "resolver_version"],
      ["resolver_version"],
    ]);
    repo = new CanonicalPersonPhoneRepo({ canonicalPersonPhoneRepository: storage });
  });

  it("decrements observation_count when > 1", async () => {
    await repo.recordObservation({ ...pk, seen_at: "2026-01-01T00:00:00.000Z" });
    await repo.recordObservation({ ...pk, seen_at: "2026-01-02T00:00:00.000Z" });
    await repo.removeObservation(pk);
    const row = await storage.get(pk);
    expect(row).toBeDefined();
    expect(row!.observation_count).toBe(1);
  });

  it("deletes the row when observation_count === 1", async () => {
    await repo.recordObservation({ ...pk, seen_at: "2026-01-01T00:00:00.000Z" });
    await repo.removeObservation(pk);
    const row = await storage.get(pk);
    expect(row).toBeUndefined();
  });

  it("is a no-op when the row does not exist", async () => {
    await expect(repo.removeObservation(pk)).resolves.toBeUndefined();
    const row = await storage.get(pk);
    expect(row).toBeUndefined();
  });
});
