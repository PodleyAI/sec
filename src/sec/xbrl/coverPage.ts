/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { XbrlDocument, XbrlFact } from "./types";

/** Deterministic dei cover-page entity data pulled from a filing's XBRL facts. */
export interface XbrlCoverPage {
  readonly documentType: string | null;
  readonly registrantName: string | null;
  readonly centralIndexKey: number | null;
  readonly incorporationStateCountryCode: string | null;
  readonly taxIdentificationNumber: string | null;
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly city: string | null;
  readonly stateOrProvince: string | null;
  readonly country: string | null;
  readonly postalZipCode: string | null;
  readonly cityAreaCode: string | null;
  readonly localPhoneNumber: string | null;
  readonly filerCategory: string | null;
  readonly smallBusiness: boolean | null;
  readonly emergingGrowthCompany: boolean | null;
  readonly exTransitionPeriod: boolean | null;
}

function deiValue(facts: ReadonlyMap<string, XbrlFact>, local: string): string | null {
  const fact = facts.get(local);
  if (!fact || fact.isNil) return null;
  const v = fact.value.trim();
  return v.length > 0 ? v : null;
}

function deiBoolean(facts: ReadonlyMap<string, XbrlFact>, local: string): boolean | null {
  const v = deiValue(facts, local);
  if (v === null) return null;
  const lower = v.toLowerCase();
  return lower === "true" ? true : lower === "false" ? false : null;
}

/**
 * Extracts the dei cover-page facts from a parsed XBRL document. When a dei
 * concept is tagged more than once, the first occurrence in document order
 * wins (cover-page facts are not dimensional in practice).
 */
export function extractXbrlCoverPage(doc: XbrlDocument): XbrlCoverPage {
  const dei = new Map<string, XbrlFact>();
  for (const fact of doc.facts) {
    const idx = fact.concept.indexOf(":");
    if (idx <= 0 || fact.concept.slice(0, idx).toLowerCase() !== "dei") continue;
    const local = fact.concept.slice(idx + 1);
    if (!dei.has(local)) dei.set(local, fact);
  }

  const cikText = deiValue(dei, "EntityCentralIndexKey");
  const cik = cikText !== null && /^\d+$/.test(cikText) ? Number(cikText) : null;

  return {
    documentType: deiValue(dei, "DocumentType"),
    registrantName: deiValue(dei, "EntityRegistrantName"),
    centralIndexKey: cik,
    incorporationStateCountryCode: deiValue(dei, "EntityIncorporationStateCountryCode"),
    taxIdentificationNumber: deiValue(dei, "EntityTaxIdentificationNumber"),
    addressLine1: deiValue(dei, "EntityAddressAddressLine1"),
    addressLine2: deiValue(dei, "EntityAddressAddressLine2"),
    city: deiValue(dei, "EntityAddressCityOrTown"),
    stateOrProvince: deiValue(dei, "EntityAddressStateOrProvince"),
    country: deiValue(dei, "EntityAddressCountry"),
    postalZipCode: deiValue(dei, "EntityAddressPostalZipCode"),
    cityAreaCode: deiValue(dei, "CityAreaCode"),
    localPhoneNumber: deiValue(dei, "LocalPhoneNumber"),
    filerCategory: deiValue(dei, "EntityFilerCategory"),
    smallBusiness: deiBoolean(dei, "EntitySmallBusiness"),
    emergingGrowthCompany: deiBoolean(dei, "EntityEmergingGrowthCompany"),
    exTransitionPeriod: deiBoolean(dei, "EntityExTransitionPeriod"),
  };
}
