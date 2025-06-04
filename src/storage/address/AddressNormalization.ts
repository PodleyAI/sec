//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { AddressParser } from "@sroussey/parse-address";
import { getCompanyEndings } from "../../util/dataCleaningUtils";
import { Address } from "./AddressSchema";
import { COUNTRY_STATE_CODE_ARRAY, KEYWORD_STATE_OR_COUNTRY_MAP } from "./AddressSchemaCodes";

export type AddressImport = {
  // required fields
  city?: string | null;
  stateOrCountry?: string | null;
  // optional fields
  stateOrCountryDescription?: string | null;
  street1?: string | null; // if street 1 is null, street 2 or 3 must have a value
  street2?: string | null;
  street3?: string | null;
  country?: string | null;
  countryCode?: string | null;
  zipCode?: string | null;
  isForeignLocation?: boolean | null;
  foreignStateTerritory?: string | null;
};

const parser = new AddressParser();
const companyRegExp = new RegExp("^[^0-9]*" + getCompanyEndings() + "$", "gi");

/**
 * Cleans street address by removing care-of patterns and company endings
 */
function cleanStreet(street: string | null | undefined): string | null {
  if (!street?.trim()) return null;

  const cleaned = street
    .trim()
    .replace(/(C\/O.*)$/i, "")
    .replace(companyRegExp, "")
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
 * Parses US addresses using address parser for standardization
 */
function normalizeUSStreetAddress(
  street1: string | null,
  street2: string | null,
  street3: string | null,
  city: string | null,
  state: string | null,
  zip: string | null
): [string | null, string | null, string | null, string | null] {
  if (!street1) return [street1, street2, street3, city];

  try {
    const streetInput = [street1, street2, street3, city, state, zip]
      .filter((s) => s?.trim())
      .join(", ");

    const parts = parser.parseLocation(streetInput);

    if (!parts) return [street1, street2, street3, city];

    const {
      number,
      prefix,
      street,
      type,
      suffix,
      sec_unit_type,
      sec_unit_num,
      city: cleanCity,
    } = parts;

    const newStreet1 =
      [number, prefix, street, type, suffix]
        .filter((s) => s?.toString().trim())
        .map((s) => s.toString().trim())
        .join(" ") || null;

    const newStreet2 =
      [sec_unit_type, sec_unit_num]
        .filter((s) => s?.toString().trim())
        .map((s) => s.toString().trim())
        .join(" ") || null;

    return [newStreet1, newStreet2, null, cleanCity];
  } catch (error) {
    console.warn("Address parsing failed:", error);
    return [street1, street2, street3, city];
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
  let state_or_country = importAddress.stateOrCountry?.trim() || null;

  [street1, street2, street3] = consolidateStreetAddresses(street1, street2, street3);

  state_or_country =
    state_or_country || findCountryByKeyword([street1, street2, street3, city, state_or_country]);

  const country_code = findCountryCode(
    state_or_country,
    importAddress.country,
    importAddress.countryCode
  );

  city = normalizeCity(city ?? "");

  if (country_code == "US") {
    [street1, street2, street3] = normalizeUSStreetAddress(
      street1,
      street2,
      street3,
      city,
      state_or_country,
      zip
    );
  }

  zip = normalizePostalCode(zip, country_code);

  if (!street1 || !state_or_country || !country_code || !city) {
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
