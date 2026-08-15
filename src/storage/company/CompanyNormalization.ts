/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  foldDiacritics,
  foldTypographicPunctuation,
  stripEdgarJurisdictionSuffix,
} from "../../util/dataCleaningUtils";
import { legalFormIdentityCanonical, legalFormIdentityStrip } from "../../util/legalForms";

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

/**
 * Word-shaped legal forms, stripped from the end of a name as whole words.
 *
 * Every entry here is a LITERAL and is escaped before it reaches a `RegExp`
 * ({@link escapeRegExp}). Phrase and placeholder suffixes live in
 * {@link LITERAL_SUFFIXES_TO_STRIP} instead, and regex SOURCE lives only in
 * {@link CANONICAL_ENDINGS} — keeping the three apart is what stops a literal
 * from being read as a pattern.
 */
const COMPANY_ENDINGS_TO_STRIP = [...legalFormIdentityStrip];

/**
 * Suffixes matched as literal text rather than as a pattern, because their
 * characters mean something to a regex engine and nothing to a company name.
 *
 * `[related person is an entity]` is a placeholder Form D puts where a name
 * would go. Interpolated into `\b${ending}\b$` its brackets became a CHARACTER
 * CLASS — `\b[related person is an entity]\b$` matches any name ending in a
 * single-letter word drawn from `{r,e,l,a,t,d,p,s,o,n,i,y}` and deleted it. So
 * `Churchill Capital Corp I` normalized to `Churchill Capital`, `Reinvent
 * Technology Partners Y` collided with `Reinvent Technology Partners` (two
 * distinct SPACs, one canonical company), and `hasCompanyEnding` — the
 * person-vs-company discriminator on Forms D / C / 1-A / 1-Z / 3 / 4 / 5 / 144 —
 * read `Klein Michael S` as a company. The class contains a literal space too,
 * which made `hasCompanyAnywhere` true for every multi-word string.
 */
const LITERAL_SUFFIXES_TO_STRIP = [
  "a Delaware limited liability company",
  "[related person is an entity]",
];

/** Escapes a literal so it matches itself inside a `RegExp`. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strips one {@link LITERAL_SUFFIXES_TO_STRIP} entry, or returns null. */
function stripLiteralSuffix(name: string): string | null {
  const lower = name.toLowerCase();
  for (const suffix of LITERAL_SUFFIXES_TO_STRIP) {
    if (lower.endsWith(suffix.toLowerCase())) {
      return name.slice(0, name.length - suffix.length).trim();
    }
  }
  return null;
}

const CANONICAL_ENDINGS = legalFormIdentityCanonical;

/**
 * The word-shaped endings as one alternation. Literal entries are escaped; only
 * {@link CANONICAL_ENDINGS} contributes regex source, and it does so
 * deliberately. {@link LITERAL_SUFFIXES_TO_STRIP} is NOT here — its entries are
 * matched by text compare, since a `\b` anchor cannot close on a `]`.
 */
const COMPANY_ENDINGS_LIST =
  "(?<companyending>" +
  [...COMPANY_ENDINGS_NO_STRIP, ...COMPANY_ENDINGS_TO_STRIP].map(escapeRegExp).join("|") +
  "|" +
  CANONICAL_ENDINGS.map(([regexp]) => regexp).join("|") +
  ")";

const companyEndingsAnywhereRegExp = new RegExp("\\b" + COMPANY_ENDINGS_LIST + "\\b", "i");
const companyEndingsRegExp = new RegExp("\\b" + COMPANY_ENDINGS_LIST + "$", "i"); // ends with
const companyEndingsOnlyRegExp = new RegExp("^" + COMPANY_ENDINGS_LIST + "$", "i");

function containsLiteralSuffix(name: string): boolean {
  const lower = name.toLowerCase();
  return LITERAL_SUFFIXES_TO_STRIP.some((s) => lower.includes(s.toLowerCase()));
}

export function hasCompanyEnding(name: string) {
  const trimmed = name?.trim() || "";
  return companyEndingsRegExp.test(trimmed) || stripLiteralSuffix(trimmed) !== null;
}

export function isCompanyEnding(name: string) {
  const trimmed = name?.trim() || "";
  return (
    companyEndingsOnlyRegExp.test(trimmed) ||
    LITERAL_SUFFIXES_TO_STRIP.some((s) => s.toLowerCase() === trimmed.toLowerCase())
  );
}

export function hasCompanyAnywhere(name: string) {
  const trimmed = name?.trim() || "";
  return companyEndingsAnywhereRegExp.test(trimmed) || containsLiteralSuffix(trimmed);
}

export function stripCompanyAllEndings(name: string): string {
  // Remove punctuation and extra whitespace for normalization
  let normalized = name
    .replace(/[\.,;:!\?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Check for common endings - keep stripping until no more are found
  let foundSuffix = true;
  while (foundSuffix) {
    foundSuffix = false;
    const literal = stripLiteralSuffix(normalized);
    if (literal !== null && literal !== normalized) {
      normalized = literal;
      foundSuffix = true;
      continue;
    }
    for (const ending of COMPANY_ENDINGS_TO_STRIP) {
      const pattern = new RegExp(`\\b${escapeRegExp(ending)}\\b$`, "i");
      if (pattern.test(normalized)) {
        normalized = normalized.replace(pattern, "").trim();
        foundSuffix = true;
        break;
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

  // Before anything else: EDGAR's `/DE`, `/CI`, `/Cayman` marker. It has to go
  // first because the legal-form strip cannot reach past it — `\bCORP\b$` does
  // not match `Blue Acquisition Corp/Cayman`, so the name kept its `Corp` and
  // minted a second canonical company beside `Blue Acquisition Corp`.
  let normalized = foldTypographicPunctuation(stripEdgarJurisdictionSuffix(name))
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
 * A derived, hyphenated slug of an already-normalized company name.
 *
 * **Not persisted, and NOT the company identity key.** No table stores it: the
 * column the company tier actually matches on is `company_observations.
 * normalized_name`, written by {@link normalizeCompanyName}, which
 * `CompanyResolver`'s name fallback and `canonical_company` are keyed on.
 * This slug lives only in the {@link Company} value object, and its one
 * in-repo consumer is the eval scorer's company match key.
 *
 * It therefore folds diacritics and the persisted key does not — a real gap, not
 * an oversight. `Søren Skou Holdings LLC` and `Soren Skou Holdings LLC` still
 * mint two `canonical_company` rows, and the remedy today is an explicit alias:
 *
 * ```sh
 * sec canonical company alias "Soren Skou Holdings LLC" "Søren Skou Holdings LLC"
 * ```
 *
 * Closing it means folding inside {@link normalizeCompanyName}, which is a
 * **re-key** of every company observation ever written — and there is no rebuild
 * path for one. `normalized_name` is written only by the extraction path, and
 * `sec resolve` re-resolves FROM that column rather than recomputing it, so a
 * fold would take effect only by re-extracting every company-observing form and
 * re-paying the AI cost of all of them. The prerequisite is teaching
 * `ResolveObservationsTask` to re-normalize as it re-partitions; until then the
 * two keys stay deliberately out of step, pinned by a test so a "fix" cannot
 * land as a silent re-key.
 */
export function generateCompanyHash(company_name: string): string {
  // `foldDiacritics` rather than a bare NFD pass: NFD leaves `ø` and `ł`
  // untouched (their mark is inside the glyph, not a combining character), so
  // the old code slugged `Søren` and `Soren` differently.
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
