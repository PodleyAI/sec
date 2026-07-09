/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyAddressRepo } from "./CanonicalCompanyAddressRepo";
import {
  CanonicalCompanyAddressPrimaryKeyNames,
  CanonicalCompanyAddressSchema,
  type CanonicalCompanyAddress,
} from "./CanonicalJunctionSchemas";

function makeStorage() {
  return new InMemoryTabularStorage<
    typeof CanonicalCompanyAddressSchema,
    typeof CanonicalCompanyAddressPrimaryKeyNames,
    CanonicalCompanyAddress
  >(CanonicalCompanyAddressSchema, CanonicalCompanyAddressPrimaryKeyNames, [
    ["canonical_company_id", "resolver_version"],
    ["resolver_version"],
  ]);
}

describe("CanonicalCompanyAddressRepo concurrency", () => {
  let storage: ReturnType<typeof makeStorage>;
  let repo: CanonicalCompanyAddressRepo;

  beforeEach(() => {
    storage = makeStorage();
    repo = new CanonicalCompanyAddressRepo({ canonicalCompanyAddressRepository: storage });
  });

  it("keeps observation_count consistent under 100 concurrent recordObservation calls for the same PK", async () => {
    const pk = {
      canonical_company_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
    };
    await Promise.all(
      Array.from({ length: 100 }, () =>
        repo.recordObservation({ ...pk, seen_at: "2026-01-01T00:00:00.000Z" })
      )
    );
    const row = await storage.get(pk);
    expect(row).toBeDefined();
    expect(row!.observation_count).toBe(100);
  });

  it("keeps observation_count consistent under mixed record+remove concurrent calls", async () => {
    const pk = {
      canonical_company_id: "uuid-1",
      address_hash_id: "addr-x",
      resolver_version: "1.0.0",
    };
    for (let i = 0; i < 50; i++) {
      await repo.recordObservation({ ...pk, seen_at: "2026-01-01T00:00:00.000Z" });
    }
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 50; i++) {
      ops.push(repo.recordObservation({ ...pk, seen_at: "2026-01-02T00:00:00.000Z" }));
      ops.push(repo.removeObservation(pk));
    }
    await Promise.all(ops);
    const row = await storage.get(pk);
    expect(row).toBeDefined();
    expect(row!.observation_count).toBe(50);
  });

  it("does not serialize different PKs", async () => {
    const N = 8;
    let entered = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const originalPut = storage.put.bind(storage);
    storage.put = async (row: CanonicalCompanyAddress) => {
      entered++;
      if (entered === N) release();
      await gate;
      return originalPut(row);
    };
    const results = Promise.all(
      Array.from({ length: N }, (_, i) =>
        repo.recordObservation({
          canonical_company_id: `uuid-${i}`,
          address_hash_id: "addr-x",
          resolver_version: "1.0.0",
          seen_at: "2026-01-01T00:00:00.000Z",
        })
      )
    );
    const deadline = Date.now() + 1000;
    while (entered < N && Date.now() < deadline) {
      await new Promise((r) => setImmediate(r));
    }
    expect(entered).toBe(N);
    await results;
  });
});
