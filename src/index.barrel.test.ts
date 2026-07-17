/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from "bun:test";
import * as sec from "./index";

test("barrel exposes the accredited-portal feature's sec dependencies", () => {
  for (const name of [
    "createStorage",
    "registerResolverExtension", "getResolverExtension", "listResolverIds", "isFamilyResolverId",
    "registerDatabaseExtension", "listDatabaseExtensionTokens",
    "VersionRegistry", "getActiveSlot", "COMPONENT_VERSION_REPOSITORY_TOKEN",
    "PersonObservationRepo", "CompanyObservationRepo",
    "PERSON_OBSERVATION_REPOSITORY_TOKEN", "COMPANY_OBSERVATION_REPOSITORY_TOKEN",
    "FILING_REPOSITORY_TOKEN",
    "normalizeCompanyName", "generateCompanyHash", "hasCompanyEnding",
    "normalizeAddress", "normalizePhone",
    "isBadPersonField", "TypeSecCik", "TypeNullable",
    "streamMatchingRows", "KeyedMutex", "parseCik",
    "createServiceToken", "InMemoryTabularStorage",
    "resetDependencyInjectionsForTesting",
    "globalServiceRegistry", "Type",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});
