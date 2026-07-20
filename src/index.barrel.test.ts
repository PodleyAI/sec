/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from "bun:test";
import * as sec from "./index";

test("barrel exposes the sec dependencies a downstream feature package builds on", () => {
  for (const name of [
    "createStorage",
    "registerResolverExtension", "getResolverExtension", "listResolverIds", "isFamilyResolverId",
    "registerDatabaseExtension", "listDatabaseExtensionTokens",
    "VersionRegistry", "computeResolverCoverage", "computeResolverCoverage", "getActiveSlot", "COMPONENT_VERSION_REPOSITORY_TOKEN",
    "PersonObservationRepo", "CompanyObservationRepo",
    "PERSON_OBSERVATION_REPOSITORY_TOKEN", "COMPANY_OBSERVATION_REPOSITORY_TOKEN",
    "FILING_REPOSITORY_TOKEN",
    "normalizeCompanyName", "generateCompanyHash", "hasCompanyEnding",
    "normalizeAddress", "normalizePhone",
    "isBadPersonField", "TypeSecCik", "TypeNullable",
    "streamMatchingRows", "KeyedMutex", "parseCik",
    "createServiceToken", "InMemoryTabularStorage",
    "setupAllDatabases", "registerDatabaseSetupHook",
    "resetDependencyInjectionsForTesting",
    "globalServiceRegistry", "Type", "Sqlite",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});

test("exports task + temporal primitives downstream ingestion needs", () => {
  expect(typeof (sec as Record<string, unknown>).Task).toBe("function");
  expect(typeof (sec as Record<string, unknown>).Workflow).toBe("function");
  expect(typeof (sec as Record<string, unknown>).isStaleByAsOf).toBe("function");
});

test("exports family-tier primitives for a downstream family resolver", () => {
  const b = sec as Record<string, unknown>;
  expect(typeof b.FamilyResolver).toBe("function");
  expect(typeof b.normalizeFamilyName).toBe("function");
  expect(typeof b.CanonicalFamilyAliasRepo).toBe("function");
});
