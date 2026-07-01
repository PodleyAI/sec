/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalPersonAddressRepo } from "./CanonicalPersonAddressRepo";
import {
  CanonicalPersonAddressPrimaryKeyNames,
  CanonicalPersonAddressSchema,
  type CanonicalPersonAddress,
} from "./CanonicalJunctionSchemas";

describe("CanonicalPersonAddressRepo.removeObservation", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalPersonAddressSchema,
    typeof CanonicalPersonAddressPrimaryKeyNames,
    CanonicalPersonAddress
  >;
  let repo: CanonicalPersonAddressRepo;
  const pk = {
    canonical_person_id: "uuid-1",
    address_hash_id: "addr-x",
    resolver_version: "1.0.0",
  };

  beforeEach(() => {
    storage = new InMemoryTabularStorage<
      typeof CanonicalPersonAddressSchema,
      typeof CanonicalPersonAddressPrimaryKeyNames,
      CanonicalPersonAddress
    >(CanonicalPersonAddressSchema, CanonicalPersonAddressPrimaryKeyNames, [
      ["canonical_person_id", "resolver_version"],
      ["resolver_version"],
    ]);
    repo = new CanonicalPersonAddressRepo({ canonicalPersonAddressRepository: storage });
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
