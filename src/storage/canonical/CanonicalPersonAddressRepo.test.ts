/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalPersonAddressPrimaryKeyNames,
  CanonicalPersonAddressSchema,
  type CanonicalPersonAddress,
} from "./CanonicalJunctionSchemas";
import { CanonicalPersonAddressRepo } from "./CanonicalPersonAddressRepo";

describe("CanonicalPersonAddressRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof CanonicalPersonAddressSchema,
    typeof CanonicalPersonAddressPrimaryKeyNames,
    CanonicalPersonAddress
  >;
  let repo: CanonicalPersonAddressRepo;

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

  it("inserts on first sighting with observation_count=1", async () => {
    const row = await repo.recordObservation({
      canonical_person_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
      seen_at: "2026-05-22T00:00:00.000Z",
    });
    expect(row.observation_count).toBe(1);
    expect(row.first_seen_at).toBe("2026-05-22T00:00:00.000Z");
    expect(row.last_seen_at).toBe("2026-05-22T00:00:00.000Z");
  });

  it("increments observation_count and updates last_seen_at on repeat", async () => {
    await repo.recordObservation({
      canonical_person_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
      seen_at: "2026-05-22T00:00:00.000Z",
    });
    const second = await repo.recordObservation({
      canonical_person_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
      seen_at: "2026-05-23T00:00:00.000Z",
    });
    expect(second.observation_count).toBe(2);
    expect(second.first_seen_at).toBe("2026-05-22T00:00:00.000Z");
    expect(second.last_seen_at).toBe("2026-05-23T00:00:00.000Z");
  });
});
