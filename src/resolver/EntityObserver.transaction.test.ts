/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { withSqliteDb } from "../config/testing/withSqliteDb";
import { CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalAliasSchemas";
import {
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalJunctionSchemas";
import { CanonicalPersonAddressRepo } from "../storage/canonical/CanonicalPersonAddressRepo";
import { CANONICAL_PERSON_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalPersonSchema";
import { PERSON_IDENTITY_LINK_REPOSITORY_TOKEN } from "../storage/canonical/PersonIdentityLinkSchema";
import { PERSON_ROLE_REPOSITORY_TOKEN } from "../storage/canonical/PersonRoleSchema";
import { PersonObservationRepo } from "../storage/observation/PersonObservationRepo";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationTitleSchema";
import { buildEntityObserver } from "./buildEntityObserver";

const ACCESSION = "0001193125-24-000001";
const EXTRACTOR_ID = "S-1";
const ADDRESS_HASH = "1 main st|new york|ny|us|10001";

describe("EntityObserver observePerson (sqlite) transactional rollback", () => {
  withSqliteDb("entity_observer_tx", [
    PERSON_OBSERVATION_REPOSITORY_TOKEN,
    PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
    PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
    PERSON_ROLE_REPOSITORY_TOKEN,
    CANONICAL_PERSON_REPOSITORY_TOKEN,
    CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
    CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
    CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
  ]);

  it("rolls back the observation when a later junction write fails", async () => {
    vi.spyOn(CanonicalPersonAddressRepo.prototype, "recordObservation").mockRejectedValue(
      new Error("forced rollback")
    );

    const observer = buildEntityObserver({
      activeResolverPersonVersion: "1.0.0",
      activeResolverCompanyVersion: "1.0.0",
    });

    await expect(
      observer.observePerson({
        accession_number: ACCESSION,
        extractor_id: EXTRACTOR_ID,
        extractor_version: "1.0.0",
        observation_index: 0,
        first_name: "Jane",
        last_name: "Doe",
        address_id: ADDRESS_HASH,
      })
    ).rejects.toThrow("forced rollback");

    const prior = await new PersonObservationRepo().getByNaturalKey(ACCESSION, EXTRACTOR_ID, 0);
    expect(prior).toBeUndefined();

    const junctions =
      (await globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN).getAll()) ?? [];
    expect(junctions).toEqual([]);
  });
});
