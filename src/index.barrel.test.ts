/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from "vitest";
import * as sec from "./index";

test("barrel exposes the sec dependencies a downstream feature package builds on", () => {
  for (const name of [
    "createStorage",
    "registerResolverExtension",
    "getResolverExtension",
    "listResolverIds",
    "isFamilyResolverId",
    "registerDatabaseExtension",
    "listDatabaseExtensionTokens",
    "VersionRegistry",
    "computeResolverCoverage",
    "computeResolverCoverage",
    "getActiveSlot",
    "COMPONENT_VERSION_REPOSITORY_TOKEN",
    "PersonObservationRepo",
    "CompanyObservationRepo",
    "PERSON_OBSERVATION_REPOSITORY_TOKEN",
    "COMPANY_OBSERVATION_REPOSITORY_TOKEN",
    "FILING_REPOSITORY_TOKEN",
    "normalizeCompanyName",
    "generateCompanyHash",
    "hasCompanyEnding",
    "normalizeAddress",
    "normalizePhone",
    "isBadPersonField",
    "TypeSecCik",
    "TypeNullable",
    "streamMatchingRows",
    "KeyedMutex",
    "parseCik",
    "createServiceToken",
    "InMemoryTabularStorage",
    "setupAllDatabases",
    "registerDatabaseSetupHook",
    "resetDependencyInjectionsForTesting",
    "globalServiceRegistry",
    "Type",
    "Sqlite",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});

test("exports task + temporal primitives downstream ingestion needs", () => {
  expect(typeof (sec as Record<string, unknown>).Task).toBe("function");
  expect(typeof (sec as Record<string, unknown>).Workflow).toBe("function");
  expect(typeof (sec as Record<string, unknown>).isStaleByAsOf).toBe("function");
  // A superset stubs SafeFetch through the barrel so it hits sec's workglow
  // singleton, not a second copy of `registerSafeFetch`.
  expect(typeof (sec as Record<string, unknown>).registerSafeFetch).toBe("function");
});

test("exports family-tier primitives for a downstream family resolver", () => {
  const b = sec as Record<string, unknown>;
  expect(typeof b.FamilyResolver).toBe("function");
  expect(typeof b.normalizeFamilyName).toBe("function");
  expect(typeof b.CanonicalFamilyAliasRepo).toBe("function");
});

test("exports the person identity tier a downstream role query joins through", () => {
  const b = sec as Record<string, unknown>;
  expect(typeof b.PersonIdentityLinkRepo).toBe("function");
  expect(typeof b.CanonicalPersonAliasRepo).toBe("function");
  expect(typeof b.PersonRoleRepo).toBe("function");
  for (const name of [
    "PERSON_IDENTITY_LINK_REPOSITORY_TOKEN",
    "CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN",
    "PERSON_ROLE_REPOSITORY_TOKEN",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});
