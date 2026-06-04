/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryTabularStorage } from "workglow";
import { CanonicalCompanyRepo } from "../storage/canonical/CanonicalCompanyRepo";
import {
  CanonicalCompanySchema,
  CanonicalCompanyPrimaryKeyNames,
  type CanonicalCompany,
} from "../storage/canonical/CanonicalCompanySchema";
import { CanonicalCompanyAliasRepo } from "../storage/canonical/CanonicalCompanyAliasRepo";
import {
  CanonicalCompanyAliasSchema,
  CanonicalCompanyAliasPrimaryKeyNames,
  type CanonicalCompanyAlias,
} from "../storage/canonical/CanonicalAliasSchemas";
import type { CompanyObservation } from "../storage/observation/CompanyObservationSchema";
import { CompanyResolver } from "./CompanyResolver";

function makeRepos() {
  const canonStorage = new InMemoryTabularStorage<
    typeof CanonicalCompanySchema,
    typeof CanonicalCompanyPrimaryKeyNames,
    CanonicalCompany
  >(CanonicalCompanySchema, CanonicalCompanyPrimaryKeyNames, [
    ["resolver_version", "cik"],
    ["resolver_version", "crd_number"],
    ["resolver_version", "normalized_name"],
  ]);
  const aliasStorage = new InMemoryTabularStorage<
    typeof CanonicalCompanyAliasSchema,
    typeof CanonicalCompanyAliasPrimaryKeyNames,
    CanonicalCompanyAlias
  >(CanonicalCompanyAliasSchema, CanonicalCompanyAliasPrimaryKeyNames, []);
  return {
    canonRepo: new CanonicalCompanyRepo({ canonicalCompanyRepository: canonStorage }),
    aliasRepo: new CanonicalCompanyAliasRepo({
      canonicalCompanyAliasRepository: aliasStorage,
    }),
    canonStorage,
  };
}

function obs(overrides: Partial<CompanyObservation>): CompanyObservation {
  return {
    observation_id: 1,
    accession_number: "0001-25-000001",
    extractor_id: "D",
    extractor_version: "1.0.0",
    observation_index: 0,
    cik: null,
    crd_number: null,
    name: null,
    normalized_name: null,
    jurisdiction: null,
    entity_type: null,
    raw_address_id: null,
    raw_phone_id: null,
    source_context: null,
    created_at: "2026-05-22T00:00:00.000Z",
    ...overrides,
  };
}

// Companion of PersonResolver.race.test.ts — covers each of the three
// key kinds (CIK, CRD, normalized name).
describe("CompanyResolver concurrent resolution", () => {
  let setup: ReturnType<typeof makeRepos>;
  let resolver: CompanyResolver;

  beforeEach(() => {
    setup = makeRepos();
    resolver = new CompanyResolver({
      canonicalCompanyRepo: setup.canonRepo,
      canonicalCompanyAliasRepo: setup.aliasRepo,
      activeResolverVersion: "1.0.0",
    });
  });

  it("two parallel resolves on the same CIK collapse to one canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ cik: 1234 })),
      resolver.resolve(obs({ cik: 1234, observation_id: 2 })),
    ]);
    expect(a).toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("two parallel resolves on the same CRD collapse to one canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ crd_number: "CRD-A1" })),
      resolver.resolve(obs({ crd_number: "CRD-A1", observation_id: 2 })),
    ]);
    expect(a).toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("two parallel resolves on the same normalized name collapse to one canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ normalized_name: "acme holdings llc" })),
      resolver.resolve(
        obs({ normalized_name: "acme holdings llc", observation_id: 2 })
      ),
    ]);
    expect(a).toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("many parallel resolves on the same CIK still produce one canonical row", async () => {
    const cik = 7777;
    const fanout = 20;
    const results = await Promise.all(
      Array.from({ length: fanout }, (_, i) =>
        resolver.resolve(obs({ cik, observation_id: i + 1 }))
      )
    );
    expect(new Set(results).size).toBe(1);
    expect((await setup.canonStorage.getAll()).length).toBe(1);
  });

  it("parallel resolves on distinct CIKs each get their own canonical row", async () => {
    const [a, b] = await Promise.all([
      resolver.resolve(obs({ cik: 1111 })),
      resolver.resolve(obs({ cik: 2222, observation_id: 2 })),
    ]);
    expect(a).not.toBe(b);
    expect((await setup.canonStorage.getAll()).length).toBe(2);
  });
});
