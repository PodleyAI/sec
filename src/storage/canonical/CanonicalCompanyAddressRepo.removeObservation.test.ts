/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyAddressRepo } from "./CanonicalCompanyAddressRepo";
import {
  CanonicalCompanyAddressPrimaryKeyNames,
  CanonicalCompanyAddressSchema,
  type CanonicalCompanyAddress,
} from "./CanonicalJunctionSchemas";

describe("CanonicalCompanyAddressRepo.removeObservation", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalCompanyAddressSchema,
    typeof CanonicalCompanyAddressPrimaryKeyNames,
    CanonicalCompanyAddress
  >;
  let repo: CanonicalCompanyAddressRepo;
  const pk = {
    canonical_company_id: "uuid-1",
    address_hash_id: "addr-x",
    resolver_version: "1.0.0",
  };

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalCompanyAddressSchema,
      typeof CanonicalCompanyAddressPrimaryKeyNames,
      CanonicalCompanyAddress
    >(CanonicalCompanyAddressSchema, CanonicalCompanyAddressPrimaryKeyNames, [
      ["canonical_company_id", "resolver_version"],
      ["resolver_version"],
    ]);
    repo = new CanonicalCompanyAddressRepo({ canonicalCompanyAddressRepository: storage });
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
