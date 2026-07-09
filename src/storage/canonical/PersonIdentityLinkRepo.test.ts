/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryTabularStorage } from "workglow";
import { PersonIdentityLinkRepo } from "./PersonIdentityLinkRepo";
import {
  PersonIdentityLinkPrimaryKeyNames,
  PersonIdentityLinkSchema,
  type PersonIdentityLink,
} from "./PersonIdentityLinkSchema";

function makeStorage() {
  return new InMemoryTabularStorage<
    typeof PersonIdentityLinkSchema,
    typeof PersonIdentityLinkPrimaryKeyNames,
    PersonIdentityLink
  >(PersonIdentityLinkSchema, PersonIdentityLinkPrimaryKeyNames, [
    ["canonical_person_id", "resolver_version"],
    ["resolver_version"],
  ]);
}

describe("PersonIdentityLinkRepo", () => {
  let storage: InMemoryTabularStorage<
    typeof PersonIdentityLinkSchema,
    typeof PersonIdentityLinkPrimaryKeyNames,
    PersonIdentityLink
  >;
  let repo: PersonIdentityLinkRepo;

  beforeEach(() => {
    storage = makeStorage();
    repo = new PersonIdentityLinkRepo({ personIdentityLinkRepository: storage });
  });

  it("upsert is idempotent on PK (same observation_id+resolver_version overwrites, row count stays 1)", async () => {
    await repo.upsert(1, "1.0.0", "canon-uuid-a");
    await repo.upsert(1, "1.0.0", "canon-uuid-b");

    const all = await repo.listAll();
    expect(all).toHaveLength(1);

    const found = await repo.getForObservation(1, "1.0.0");
    expect(found?.canonical_person_id).toBe("canon-uuid-b");
  });

  it("cross-version coexistence: same observation with two resolver_versions → two rows, each getForObservation returns the right one", async () => {
    await repo.upsert(42, "1.0.0", "canon-v1");
    await repo.upsert(42, "2.0.0", "canon-v2");

    const all = await repo.listAll();
    expect(all).toHaveLength(2);

    const v1 = await repo.getForObservation(42, "1.0.0");
    expect(v1?.canonical_person_id).toBe("canon-v1");

    const v2 = await repo.getForObservation(42, "2.0.0");
    expect(v2?.canonical_person_id).toBe("canon-v2");
  });

  it("deleteForResolverVersion removes only matching rows; other versions remain", async () => {
    await repo.upsert(10, "1.0.0", "canon-10-v1");
    await repo.upsert(11, "1.0.0", "canon-11-v1");
    await repo.upsert(10, "2.0.0", "canon-10-v2");

    const deleted = await repo.deleteForResolverVersion("1.0.0");
    expect(deleted).toBe(2);

    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].resolver_version).toBe("2.0.0");
    expect(all[0].observation_id).toBe(10);
  });
});
