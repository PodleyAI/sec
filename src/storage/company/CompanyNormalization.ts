/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { foldDiacritics, foldTypographicPunctuation } from "../../util/dataCleaningUtils";

export type CompanyImport = {
  company_name: string;
  country_code?: string;
  cik?: number | null;
  crd?: string | null;
};

export type Company = {
  company_hash_id: string;
  company_name: string;
  country_code?: string | null;
  suffix?: string | null;
  cik?: number | null;
  crd?: string | null;
};

// Common company endings to strip for normalization
// Order matters - more specific patterns should come first
const COMPANY_ENDINGS_NO_STRIP = [
  "DST",
  "DEVELOPMENT",
  "HOLDINGS",
  "HOLDING",
  "GROUP",
  "ENTERPRISES",
  "ENTERPRISE",
  "SOLUTIONS",
  "SYSTEMS",
  "TECHNOLOGIES",
  "TECHNOLOGY",
  "TECH",
  "SERVICES",
  "SERVICE",
  "CONSULTING",
  "CONSULTANTS",
  "PARTNERS",
  "PARTNERSHIP",
  "ASSOCIATES",
  "ASSOCIATION",
  "INTERNATIONAL",
  "INTL",
  "GLOBAL",
  "WORLDWIDE",
  "NATIONAL",
  "USA",
  "US",
  "AMERICA",
  "AMERICAN",
];

const COMPANY_ENDINGS_TO_STRIP = [
  "INC",
  "INCORPORATED",
  "CORPORATION",
  "CORP",
  "COMPANY",
  "CO",
  "PTE",
  "LTD",
  "LIMITED",
  "a Delaware limited liability company",
  "[related person is an entity]",
];

const CANONICAL_ENDINGS = [
  ["S[\\., ]{0,2}A[\\., ]{0,2}R[\\., ]{0,2}L[\\., ]{0,2}", "SARL"],
  ["L[\\., ]{0,2}L[\\., ]{0,2}C[\\., ]{0,2}", "LLC"],
  ["Limited Liability Company", "LLC"],
  ["Limited Liability Partnership", "LLP"],
  ["L[\\., ]{0,2}L[\\., ]{0,2}P\\.", "LLP"],
  ["P[\\., ]{0,2}L[\\., ]{0,2}L[\\., ]{0,2}C\\.", "PLLC"],
  ["L[\\., ]{0,2}P[\\., ]{0,2}", "LP"],
  ["G[\\., ]{0,2}P[\\., ]{0,2}", "GP"],
  ["P[\\., ]{0,2}C[\\., ]{0,2}", "PC"],
  ["P[\\., ]{0,2}A[\\., ]{0,2}", "PA"],
];

const COMPANY_ENDINGS_LIST =
  "(?<companyending>" +
  COMPANY_ENDINGS_NO_STRIP.join("|") +
  "|" +
  COMPANY_ENDINGS_TO_STRIP.join("|") +
  "|" +
  CANONICAL_ENDINGS.map(([regexp]) => regexp).join("|") +
  ")";

const companyEndingsAnywhereRegExp = new RegExp("\\b" + COMPANY_ENDINGS_LIST + "\\b", "i");
const companyEndingsRegExp = new RegExp("\\b" + COMPANY_ENDINGS_LIST + "$", "i"); // ends with
const companyEndingsOnlyRegExp = new RegExp("^" + COMPANY_ENDINGS_LIST + "$", "i");

export function hasCompanyEnding(name: string) {
  return companyEndingsRegExp.test(name?.trim() || "");
}

export function isCompanyEnding(name: string) {
  return companyEndingsOnlyRegExp.test(name?.trim() || "");
}

export function hasCompanyAnywhere(name: string) {
  return companyEndingsAnywhereRegExp.test(name?.trim() || "");
}

export function stripCompanyAllEndings(name: string): string {
  let suffix: string | null = null;

  // Store original for suffix detection
  let original = name;

  // Remove punctuation and extra whitespace for normalization
  let normalized = name
    .replace(/[\.,;:!\?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Check for common endings - keep stripping until no more are found
  let foundSuffix = true;
  while (foundSuffix) {
    foundSuffix = false;
    for (const ending of COMPANY_ENDINGS_TO_STRIP) {
      // For patterns with escaped dots, we need to handle them differently
      if (ending.includes("\\.")) {
        const pattern = new RegExp(`\\s*${ending}\\s*$`, "i");
        if (pattern.test(original)) {
          suffix = original.match(pattern)?.[0]?.trim() || null;
          normalized = original.replace(pattern, "").trim();
          // Clean the normalized version after removing suffix
          normalized = normalized.replace(/\s+/g, " ").trim();
          // Update original for next iteration
          original = normalized;
          foundSuffix = true;
          break;
        }
      } else {
        const pattern = new RegExp(`\\b${ending}\\b$`, "i");
        if (pattern.test(normalized)) {
          suffix = normalized.match(pattern)?.[0] || null;
          normalized = normalized.replace(pattern, "").trim();
          foundSuffix = true;
          break;
        }
      }
    }
  }
  return normalized;
}

const ENDINGS_TO_REMOVE = [
  "a Delaware limited liability company",
  "[related person is an entity]",
  ",",
  ".",
];

export const removeEndings = (name: string) => {
  for (const ending of ENDINGS_TO_REMOVE) {
    name = name.replace(ending, "").trim();
  }
  return name;
};

const canonicalEndings = (name: string) => {
  for (const [regexp, canonical] of CANONICAL_ENDINGS) {
    // String-concat the word boundaries: inside a template literal, `\b` is
    // the backspace character (U+0008), not a word-boundary escape. The
    // previous template-literal form silently no-op'd against every
    // ordinary input — only matching strings that contain literal backspace
    // bytes — so canonicalisations like "L.L.C." → "LLC" never fired here
    // and only converged accidentally via stripCompanyAllEndings.
    name = name.replace(new RegExp("\\b" + regexp + "\\b", "i"), canonical);
  }
  return name;
};

const COMPANY_RENAMINGS = new Map<string, string>([
  ["international business machines", "IBM"],
  ["apple", "Apple Computer"],
]);

const companyRenamings = (name: string) => {
  if (COMPANY_RENAMINGS.has(name.toLowerCase())) {
    name = COMPANY_RENAMINGS.get(name.toLowerCase())!;
  }
  return name;
};

/**
 * Normalizes a company name by stripping common endings
 */
export function normalizeCompanyName(name: string): string | null {
  if (name === null || name === undefined || name === "") return null;

  let normalized = foldTypographicPunctuation(name)
    .replace(/[\.,;:!\?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  normalized = canonicalEndings(normalized);
  normalized = stripCompanyAllEndings(normalized);
  normalized = companyRenamings(normalized);

  normalized = removeEndings(normalized);

  return normalized;
}

/**
 * Generates a hash ID for a company based on normalized name components
 */
export function generateCompanyHash(company_name: string): string {
  // `foldDiacritics` rather than a bare NFD pass: NFD leaves `ø` and `ł`
  // untouched (their mark is inside the glyph, not a combining character), so
  // the old code hashed `Søren` and `Soren` to two different companies.
  const hashString = foldDiacritics(company_name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/-&-/g, "-and-")
    .replaceAll(/\//g, "-")
    .replaceAll(/--/g, "-")
    .trim()
    .replace(/^-|-$/g, "");

  return hashString;
}

/**
 * Cleans and normalizes a company import object
 */
export function normalizeCompany(
  importCompany: CompanyImport | string | null
): Company | undefined {
  if (!importCompany) return undefined;
  if (typeof importCompany === "string") {
    importCompany = { company_name: importCompany };
  }

  const normalized = normalizeCompanyName(importCompany.company_name);

  if (!normalized) {
    return undefined;
  }

  const companyHashId = generateCompanyHash(normalized);

  return {
    company_hash_id: companyHashId,
    company_name: normalized,
    country_code: importCompany.country_code || null,
    cik: importCompany.cik || null,
    crd: importCompany.crd || null,
  };
}
