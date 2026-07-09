/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import {
  CanonicalPersonAddressPrimaryKeyNames,
  CanonicalPersonAddressSchema,
  type CanonicalPersonAddress,
} from "./CanonicalJunctionSchemas";
import { CanonicalPersonAddressRepo } from "./CanonicalPersonAddressRepo";

function makeStorage() {
  return new InMemoryTabularStorage<
    typeof CanonicalPersonAddressSchema,
    typeof CanonicalPersonAddressPrimaryKeyNames,
    CanonicalPersonAddress
  >(CanonicalPersonAddressSchema, CanonicalPersonAddressPrimaryKeyNames, [
    ["canonical_person_id", "resolver_version"],
    ["resolver_version"],
  ]);
}

describe("CanonicalPersonAddressRepo concurrency", () => {
  let storage: ReturnType<typeof makeStorage>;
  let repo: CanonicalPersonAddressRepo;

  beforeEach(() => {
    storage = makeStorage();
    repo = new CanonicalPersonAddressRepo({ canonicalPersonAddressRepository: storage });
  });

  it("keeps observation_count consistent under 100 concurrent recordObservation calls for the same PK", async () => {
    const pk = {
      canonical_person_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
    };
    await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        repo.recordObservation({
          ...pk,
          seen_at: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
        })
      )
    );
    const row = await storage.get(pk);
    expect(row).toBeDefined();
    expect(row!.observation_count).toBe(100);
  });

  it("keeps observation_count consistent under mixed record+remove concurrent calls", async () => {
    const pk = {
      canonical_person_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
    };
    // Seed to 50 so the 50 removes and 50 records net to a row of count 50.
    for (let i = 0; i < 50; i++) {
      await repo.recordObservation({ ...pk, seen_at: "2026-01-01T00:00:00.000Z" });
    }
    // Interleave 50 records + 50 removes concurrently.
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 50; i++) {
      ops.push(repo.recordObservation({ ...pk, seen_at: "2026-01-02T00:00:00.000Z" }));
      ops.push(repo.removeObservation(pk));
    }
    await Promise.all(ops);
    const row = await storage.get(pk);
    // Net change: +50 -50 = 0; starting at 50 -> final 50.
    expect(row).toBeDefined();
    expect(row!.observation_count).toBe(50);
  });

  it("does not serialize different PKs", async () => {
    // Distinct PKs must not block each other. Wrap storage.put with a barrier
    // so all put calls stall until every one has arrived.
    const N = 8;
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const originalPut = storage.put.bind(storage);
    storage.put = async (row: CanonicalPersonAddress) => {
      entered++;
      if (entered === N) release();
      await gate;
      return originalPut(row);
    };
    const results = Promise.all(
      Array.from({ length: N }, (_, i) =>
        repo.recordObservation({
          canonical_person_id: `uuid-${i}`,
          address_hash_id: "addr-x",
          resolver_version: "1.0.0",
          seen_at: "2026-01-01T00:00:00.000Z",
        })
      )
    );
    // If different PKs were serialized, only the first put would enter the barrier.
    // Poll macrotasks until all concurrent puts arrive (or a reasonable timeout).
    const deadline = Date.now() + 1000;
    while (entered < N && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    expect(entered).toBe(N);
    await results;
  });
});
