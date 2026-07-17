/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseFullName } from "@sroussey/parse-full-name";
import { foldTypographicPunctuation } from "../../util/dataCleaningUtils";

export type PersonImport = {
  name: string;
  cik?: number | null;
  crd?: string | null;
};

export type Person = {
  person_hash_id: string;
  first: string;
  middle: string | null;
  last: string;
  suffix: string | null;
  title: string | null;
  nick: string | null;
  dob?: string | null;
  notes?: string | null;
  cik?: number | null;
  crd?: string | null;
};

/**
 * Generates a hash ID for a person based on normalized name components
 */
function generatePersonHash(person: Omit<Person, "person_hash_id">): string {
  const hashString = [
    person.first,
    person.middle,
    person.nick,
    person.last,
    person.suffix,
    person.notes,
  ]
    .filter((v) => v !== null && v !== undefined)
    .join("-")
    .toLowerCase()
    .replaceAll(/[\. ]/g, "-")
    .replaceAll(/--+/g, "-")
    .trim()
    .replace(/^-|-$/g, "");

  return hashString;
}

/**
 * Strip identity-neutral punctuation from a parsed name part so two spellings of
 * the same person collapse: initials ("J." vs "J") and suffixes ("Jr." vs "Jr",
 * "Martire, III" already comma-split by the parser). Apostrophes and hyphens are
 * meaningful in names and are preserved. Returns null for an emptied value.
 */
function stripNamePartPunctuation(part: string | null): string | null {
  if (part === null || part === undefined) return part ?? null;
  const cleaned = part
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" ? null : cleaned;
}

/**
 * Cleans and normalizes a person import object
 */
export function normalizePerson(importPerson: PersonImport | null): Person | undefined {
  if (!importPerson) return undefined;

  // Extract name, cik, and crd from the object
  const name = importPerson.name;
  const cik = importPerson.cik || null;
  const crd = importPerson.crd || null;

  // Fold typographic punctuation (curly apostrophes, en/em dashes) to ASCII
  // BEFORE parsing so the parser's case-fixing keys off a consistent character
  // — otherwise "D’Angelo" (U+2019) case-folds to "D’angelo" while "D'Angelo"
  // gives "D'Angelo", splitting the same person into two canonical rows.
  const cleanPerson = foldTypographicPunctuation(name.replace("/s/", "").trim());

  const results = parseFullName(cleanPerson, { normalize: true, fixCase: 1 });

  if (results.error?.length) {
    // console.error(`Error parsing full name: ${importPerson}, but moving on...`, results.error);
  }

  if (!results.first || !results.last) {
    return undefined;
  }

  // Strip identity-neutral punctuation (initial/suffix periods) so the resolver
  // key ("first|middle|last|suffix") is stable across spelling variants.
  const person: Omit<Person, "person_hash_id"> = {
    first: stripNamePartPunctuation(results.first) ?? results.first,
    middle: stripNamePartPunctuation(results.middle),
    last: stripNamePartPunctuation(results.last) ?? results.last,
    suffix: stripNamePartPunctuation(results.suffix),
    title: results.title,
    nick: results.nick,
    dob: null,
    notes: null,
    cik,
    crd,
  };

  const personHashId = generatePersonHash(person);

  return {
    ...person,
    person_hash_id: personHashId,
  };
}
