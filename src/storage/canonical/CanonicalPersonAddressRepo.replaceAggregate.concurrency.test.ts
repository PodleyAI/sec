/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
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

/** The single composite PK every call in this file contends for. */
const PK = {
  canonical_person_id: "uuid-1",
  address_hash_id: "addr-x",
  resolver_version: "1.0.0",
} as const;

/** Wall-clock seen-at values — the shape the incremental writer stamps. */
const SEED_INSTANT = "2026-01-01T00:00:00.000Z";
const RECORD_INSTANT = "2026-01-02T00:00:00.000Z";

/**
 * Filing-date seen-at values and a count no sequence of increments here could
 * reach — the shape a projection writes, so a final row carrying them can only
 * descend from the aggregate, and one carrying {@link SEED_INSTANT} can only
 * descend from a read taken before the aggregate was written.
 */
const AGGREGATE_FIRST_SEEN = "2024-03-01";
const AGGREGATE_LAST_SEEN = "2024-09-30";
const AGGREGATE_COUNT = 500;

/** Increments issued after the aggregate, which a serialised run applies on top of it. */
const RECORDS_AFTER = 25;

/**
 * Which `get` call is the in-flight increment's: 1 is the seeding
 * `recordObservation`, 2 the increment this test parks mid-flight.
 */
const IN_FLIGHT_READ = 2;

describe("CanonicalPersonAddressRepo.replaceAggregate concurrency", () => {
  let storage: ReturnType<typeof makeStorage>;
  let repo: CanonicalPersonAddressRepo;

  beforeEach(() => {
    storage = makeStorage();
    repo = new CanonicalPersonAddressRepo({ canonicalPersonAddressRepository: storage });
  });

  it("keeps an aggregate write whole against a concurrent recordObservation on the same PK", async () => {
    // A projection's replace and live ingestion's +1 target the same row, and
    // the +1 is a read-modify-write. An unserialised replace landing between
    // that read and its write is silently undone: the increment writes back a
    // row derived from the pre-replace read, and the whole aggregate — count
    // and both seen-at bounds — is gone. Park every read on a macrotask so the
    // interleaving is arranged rather than left to microtask luck.
    let announceInFlightRead!: () => void;
    const inFlightReadTaken = new Promise<void>((resolve) => (announceInFlightRead = resolve));
    let reads = 0;
    const originalGet = storage.get.bind(storage);
    storage.get = async (key) => {
      const row = await originalGet(key);
      reads += 1;
      if (reads === IN_FLIGHT_READ) announceInFlightRead();
      await new Promise((resolve) => setImmediate(resolve));
      return row;
    };

    await repo.recordObservation({ ...PK, seen_at: SEED_INSTANT });

    // An increment that has read the row and has not yet written it back.
    const inFlight = repo.recordObservation({ ...PK, seen_at: RECORD_INSTANT });
    await inFlightReadTaken;

    // Issued in one synchronous burst while that read is outstanding, so the
    // lock queues them behind it in call order: the aggregate, then the
    // increments that follow it.
    const ops: Array<Promise<unknown>> = [
      inFlight,
      repo.replaceAggregate({
        ...PK,
        observation_count: AGGREGATE_COUNT,
        first_seen_at: AGGREGATE_FIRST_SEEN,
        last_seen_at: AGGREGATE_LAST_SEEN,
      }),
    ];
    for (let i = 0; i < RECORDS_AFTER; i++) {
      ops.push(repo.recordObservation({ ...PK, seen_at: RECORD_INSTANT }));
    }
    await Promise.all(ops);

    const row = await storage.get(PK);
    expect(row).toBeDefined();
    // Serialised, the in-flight increment completes first and the aggregate
    // supersedes it, leaving the aggregate plus the increments queued after
    // it. Unserialised, the in-flight increment writes its stale row back on
    // top of the aggregate and the run ends on a seed-derived count and
    // `first_seen_at` instead.
    expect(row!.first_seen_at).toBe(AGGREGATE_FIRST_SEEN);
    expect(row!.observation_count).toBe(AGGREGATE_COUNT + RECORDS_AFTER);
    expect(row!.last_seen_at).toBe(RECORD_INSTANT);
  });
});
