/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyPhoneRepo } from "./CanonicalCompanyPhoneRepo";
import {
  CanonicalCompanyPhonePrimaryKeyNames,
  CanonicalCompanyPhoneSchema,
  type CanonicalCompanyPhone,
} from "./CanonicalJunctionSchemas";

describe("CanonicalCompanyPhoneRepo.removeObservation", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalCompanyPhoneSchema,
    typeof CanonicalCompanyPhonePrimaryKeyNames,
    CanonicalCompanyPhone
  >;
  let repo: CanonicalCompanyPhoneRepo;
  const pk = {
    canonical_company_id: "uuid-1",
    international_number: "+14155551234",
    resolver_version: "1.0.0",
  };

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalCompanyPhoneSchema,
      typeof CanonicalCompanyPhonePrimaryKeyNames,
      CanonicalCompanyPhone
    >(CanonicalCompanyPhoneSchema, CanonicalCompanyPhonePrimaryKeyNames, [
      ["canonical_company_id", "resolver_version"],
      ["resolver_version"],
    ]);
    repo = new CanonicalCompanyPhoneRepo({ canonicalCompanyPhoneRepository: storage });
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
