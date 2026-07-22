/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { AddressParser } from "@sroussey/parse-address";
import { hasCompanyEnding } from "../company/CompanyNormalization";
import { Address, type CountryCode, type StateOrCountryCode } from "./AddressSchema";
import { COUNTRY_STATE_CODE_ARRAY, KEYWORD_STATE_OR_COUNTRY_MAP } from "./AddressSchemaCodes";

export type AddressImport = {
  // required fields
  city?: string | null;
  stateOrCountry?: StateOrCountryCode | string | null;
  countryCode?: CountryCode | string | null;
  // optional fields
  stateOrCountryDescription?: string | null;
  street1?: string | null; // if street 1 is null, street 2 or 3 must have a value
  street2?: string | null;
  street3?: string | null;
  country?: string | null;
  zipCode?: string | null;
  isForeignLocation?: boolean | null;
  foreignStateTerritory?: string | null;
};

// One parser per supported country. EDGAR carries US and Canadian addresses
// with parseable street lines; every other country keeps its raw street line
// (see streetParserForCountry).
const usAddressParser = new AddressParser("us");
const caAddressParser = new AddressParser("ca");

/**
 * French-language street lines lead with the street type ("123 Rue Principale")
 * rather than trailing it ("123 Main St"). Used to preserve the source ordering
 * when rebuilding a Canadian street line — see {@link normalizeStreetAddress}.
 */
const FRENCH_LEADING_STREET_TYPES = new Set([
  "rue",
  "chemin",
  "avenue",
  "av",
  "boulevard",
  "boul",
  "bd",
  "allee",
  "allée",
  "cote",
  "côte",
  "place",
  "impasse",
  "montee",
  "montée",
  "rang",
  "croissant",
  "ruelle",
  "voie",
  "promenade",
  "carre",
  "carré",
  "cours",
]);

/**
 * Resolves the street parser for a resolved ISO country code, or null when the
 * country has no dedicated parser (the raw street line is then kept as-is).
 */
function streetParserForCountry(countryCode: string | null): AddressParser | null {
  switch (countryCode) {
    case "US":
      return usAddressParser;
    case "CA":
      return caAddressParser;
    default:
      return null;
  }
}

/**
 * Cleans street address by removing care-of patterns and company endings
 */
function cleanStreet(street: string | null | undefined): string | null {
  if (!street?.trim()) return null;

  if (hasCompanyEnding(street)) {
    return null;
  }

  const cleaned = street
    .trim()
    .replace(/(C\/O.*)$/i, "")
    .replace(/(C\/O.*)$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

/**
 * Consolidates street addresses by moving non-null values up
 */
function consolidateStreetAddresses(
  street1: string | null,
  street2: string | null,
  street3: string | null
): [string | null, string | null, string | null] {
  const streets = [street1, street2, street3].filter((s) => s?.trim());

  return [streets[0] || null, streets[1] || null, streets[2] || null];
}

/**
 * Normalizes postal codes for different countries
 */
function normalizePostalCode(
  postalCode: string | null | undefined,
  countryCode: string | null
): string | null {
  if (!postalCode?.trim()) return null;

  const trimmed = postalCode.trim().toUpperCase();

  switch (countryCode) {
    case "US":
      // Extract 5-digit zip from 9-digit format
      const zip9Match = /([0-9]{5})-[0-9]{4}/.exec(trimmed);
      if (zip9Match) return zip9Match[1];

      // Validate 5-digit zip
      if (/^[0-9]{5}$/.test(trimmed)) return trimmed;
      break;

    case "CA":
      // Canadian postal code format: A1A 1A1
      const canadianMatch = trimmed.match(/^([A-Z]\d[A-Z])\s?(\d[A-Z]\d)$/);
      if (canadianMatch) {
        return `${canadianMatch[1]} ${canadianMatch[2]}`;
      }
      break;

    case "GB":
      // UK postal codes have various formats
      const ukMatch = trimmed.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)\s?(\d[A-Z]{2})$/);
      if (ukMatch) {
        return `${ukMatch[1]} ${ukMatch[2]}`;
      }
      break;

    default:
      // For other countries, just return trimmed version
      return trimmed;
  }

  // Return original if it doesn't match expected patterns
  return trimmed;
}

/**
 * Counts whitespace-separated tokens across the given lines (punctuation folded
 * to spaces). Abbreviation ("Street" → "St") and reordering keep the token count
 * unchanged; dropping a word lowers it — see the loss guard in
 * {@link normalizeStreetAddress}.
 */
function streetTokenCount(...lines: (string | null)[]): number {
  return lines
    .filter((line): line is string => !!line)
    .join(" ")
    .toLowerCase()
    .replace(/[.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Standardizes a street line via the country's address parser: abbreviates the
 * street type, folds a secondary-unit designator down into street2, and (for
 * Canada) preserves French leading-type ordering.
 *
 * Only the street lines are handed to the parser. City/state/postal come
 * pre-separated from EDGAR as structured fields and are deliberately excluded
 * from the parse input: EDGAR's `stateOrCountry` is a SEC region code (e.g.
 * "A8" for Quebec), not one the parser recognizes, and appending it would trip
 * the parser's token-preservation fallback into returning the whole string as
 * `street`. The EDGAR-supplied `zipCode` (via {@link normalizePostalCode}) is
 * authoritative, so there is nothing to gain from re-deriving it here either.
 */
function normalizeStreetAddress(
  parser: AddressParser,
  street1: string | null,
  street2: string | null,
  street3: string | null
): [string | null, string | null, string | null] {
  if (!street1) return [street1, street2, street3];

  try {
    const streetInput = [street1, street2, street3]
      .filter((s) => s?.trim())
      .join(", ");

    const parts = parser.parseLocation(streetInput);

    if (!parts) return [street1, street2, street3];

    const { number, civic_number_suffix, prefix, street, type, suffix, sec_unit_type, sec_unit_num } =
      parts;

    const houseNumber =
      [number, civic_number_suffix]
        .filter((s): s is string => Boolean(s?.toString().trim()))
        .map((s) => s.toString().trim())
        .join("") || null;

    // A French street line leads with the type ("123 Rue Principale") while an
    // English one trails it ("123 Main St"). The parser splits `type` out either
    // way, so keying off the source ordering — the first token after the civic
    // number — is what prevents rebuilding "123 Rue Principale" as the reordered
    // "123 Principale Rue". Ambiguous words (Avenue, Place) are disambiguated by
    // position, not by the word itself.
    const streetHint = street1.replace(/^\s*\d+[a-z]?\s+/i, "").trimStart();
    const firstToken = streetHint.split(/[\s,]+/)[0]?.toLowerCase().replace(/[.]/g, "") ?? "";
    const typeLeadsStreet = !!type && !!street && FRENCH_LEADING_STREET_TYPES.has(firstToken);

    const orderedStreet1 = typeLeadsStreet
      ? [houseNumber, prefix, type, street, suffix]
      : [houseNumber, prefix, street, type, suffix];

    const newStreet1 =
      orderedStreet1
        .filter((s): s is string => Boolean(s?.toString().trim()))
        .map((s) => s.toString().trim())
        .join(" ") || null;

    const newStreet2 =
      [sec_unit_type, sec_unit_num]
        .filter((s): s is string => Boolean(s?.toString().trim()))
        .map((s) => s.toString().trim())
        .join(" ") || null;

    // Loss guard (defense-in-depth): @sroussey/parse-address 3.x already
    // guarantees it never drops a street token, but keep a local check anyway —
    // if the rebuilt lines ever carry fewer tokens than the source, keep the raw
    // lines rather than persist a truncated address.
    if (streetTokenCount(newStreet1, newStreet2) < streetTokenCount(street1, street2, street3)) {
      return [street1, street2, street3];
    }

    if (newStreet1) {
      return [newStreet1, newStreet2, null];
    } else if (newStreet2) {
      return [newStreet2, null, null];
    }
    return [null, null, null];
  } catch (error) {
    console.warn("Address parsing failed:", error);
    return [street1, street2, street3];
  }
}

/**
 * Finds country/state code by keyword matching in address components
 * as people make lots of mistakes, we can try to undo them.
 *
 * @param columns - array of strings to search for keywords
 * @returns country code or empty string if no match found
 */
function findCountryByKeyword(columns: (string | null | undefined)[]): string {
  const validColumns = columns.filter(
    (col): col is string => typeof col === "string" && col.trim().length > 0
  );

  for (const col of validColumns) {
    const upper = col.toUpperCase();
    for (const [keyword, country] of KEYWORD_STATE_OR_COUNTRY_MAP) {
      if (upper.includes(keyword)) {
        return country;
      }
    }
  }
  return "";
}

/**
 * Finds country code using multiple fallback strategies
 */
function findCountryCode(
  stateOrCountry: string | null | undefined,
  country: string | null | undefined,
  countryCode: string | null | undefined
): string | null {
  // Try to find by state/country code
  const byState = COUNTRY_STATE_CODE_ARRAY.find(([iso, sec, state]) => sec === stateOrCountry)?.[0];

  if (byState) return byState;

  // Try to find by country name
  const byCountryName = COUNTRY_STATE_CODE_ARRAY.find(
    ([iso, sec, state, countryName]) => countryName === country
  )?.[0];

  if (byCountryName) return byCountryName;

  // Return provided country code if valid
  if (countryCode?.trim()) return countryCode.trim();

  return null;
}

/**
 * Generates a deterministic hash for the address using crypto
 */
function generateAddressHash(address: Omit<Address, "address_hash_id">): string {
  const addressString = Object.values(address)
    .map((value) => (value || "").toString().toLowerCase().trim())
    .filter((v) => v !== null && v !== undefined && v !== "")
    .join("|");

  return addressString;
}

/**
 * Normalizes city name by removing common variations
 */
function normalizeCity(city: string): string {
  return city
    .trim()
    .replace(/\b(SAINT|ST\.?)\b/gi, "ST")
    .replace(/\b(MOUNT|MT\.?)\b/gi, "MT")
    .replace(/\b(NYC?)\b/gi, "New York")
    .replace(/\b(New York City)\b/gi, "New York")
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeAddress(importAddress: AddressImport | null): Address | undefined {
  if (!importAddress) return undefined;

  let street1 = cleanStreet(importAddress.street1);
  let street2 = cleanStreet(importAddress.street2);
  let street3 = cleanStreet(importAddress.street3);
  let zip = importAddress.zipCode?.trim() || null;
  let city = importAddress.city?.trim() || null;
  let state_or_country: StateOrCountryCode | null =
    (importAddress.stateOrCountry?.trim() as StateOrCountryCode | null) || null;

  [street1, street2, street3] = consolidateStreetAddresses(street1, street2, street3);

  state_or_country =
    state_or_country ||
    (findCountryByKeyword([
      street1,
      street2,
      street3,
      city,
      state_or_country,
    ]) as StateOrCountryCode | null);

  let country_code = findCountryCode(
    state_or_country,
    importAddress.country,
    importAddress.countryCode
  ) as CountryCode | null;

  city = normalizeCity(city ?? "");

  const streetParser = streetParserForCountry(country_code);
  if (streetParser) {
    [street1, street2, street3] = normalizeStreetAddress(
      streetParser,
      street1,
      street2,
      street3
    );
  }

  zip = normalizePostalCode(zip, country_code);

  if (!street1 && importAddress.street1) {
    street1 = importAddress.street1;
    street2 = importAddress.street2 || null;
    street3 = importAddress.street3 || null;
    city = city || importAddress.city || null;
    state_or_country =
      state_or_country || (importAddress.stateOrCountry as StateOrCountryCode) || null;
    country_code = country_code || (importAddress.countryCode as CountryCode) || null;
    zip = zip || importAddress.zipCode || null;
  }

  if (!street1 || !state_or_country || !city || !country_code) {
    return undefined;
  }

  // Create clean address object
  const cleanedAddress: Omit<Address, "address_hash_id"> = {
    street1,
    street2,
    street3,
    city,
    state_or_country,
    country_code,
    zip,
  };

  const hash = generateAddressHash(cleanedAddress);

  const address: Address = {
    address_hash_id: hash,
    ...cleanedAddress,
  };

  return address;
}
