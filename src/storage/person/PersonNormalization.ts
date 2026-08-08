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
  /**
   * Every trailing name part as one comma-joined string — generational ("Jr.",
   * "III") and professional ("CPA", "Ph.D.") alike. This reaches
   * `normalized_suffix`, a member of the resolver's match tuple, so its spelling
   * decides which canonical person an observation resolves to.
   */
  suffix: string | null;
  title: string | null;
  nick: string | null;
  dob?: string | null;
  notes?: string | null;
  cik?: number | null;
  crd?: string | null;
};

/** Empty string is how `parseFullName` reports an absent part; we store null. */
function emptyToNull(value: string | undefined): string | null {
  return value === undefined || value.trim() === "" ? null : value;
}

/**
 * Re-joins the two trailing-part fields `parseFullName` v3 reports separately —
 * `generation` ("Jr.", "III") and `credential` ("CPA", "M.D., CFA") — into the
 * single comma-joined suffix v2 returned, which is the spelling every
 * `canonical_person.normalized_suffix` written so far was derived from.
 *
 * Keeping only the generational half is the better rule: a credential says how
 * ONE filing annotated a person, not who they are. But `normalized_suffix` sits
 * in the resolver's match tuple, so narrowing it changes which canonical row an
 * observation matches. Rows already written under the combined spelling stop
 * matching and the next filing naming the same person mints a SECOND canonical
 * row at the same `resolver_version` — an identity split with nothing to
 * distinguish it from a legitimate row. Splitting the two fields is therefore a
 * resolver-version-gated change: bump the `person` resolver, re-resolve, then
 * land it.
 *
 * Order is generational-first, which is how filings write it ("Jr., CPA"); v2
 * preserved the filing's own order, so a name that wrote a credential ahead of a
 * generational suffix joins back in the opposite order.
 */
function combineSuffixParts(generation: string, credential: string): string | null {
  return emptyToNull([generation, credential].filter((part) => part.trim() !== "").join(", "));
}

/**
 * Generates a hash ID for a person based on normalized name components
 */
function generatePersonHash(person: Omit<Person, "person_hash_id">): string {
  // `nick` is deliberately absent: it has no `normalized_*` column, so it never
  // reaches `PersonResolver.personKey`. Listing exactly the parts that tuple
  // uses keeps this hash and the resolver from disagreeing about who is the
  // same person — they did before, in both directions.
  const hashString = [person.first, person.middle, person.last, person.suffix, person.notes]
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
  const cleaned = part.replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
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
  //
  // A parenthesized nickname stays in `nick` and out of `middle`. `nick` has no
  // column in the observation row, so it reaches neither `normalized_middle` nor
  // the resolver's match tuple: "Yong (David) Yan" and "Yong Yan" resolve to one
  // canonical person. Folding it into `middle` is arguably the better rule — the
  // adopted Western name is often the only token separating two people on a
  // roster — but it moves the match tuple, so it belongs behind a `person`
  // resolver version bump, not in a build that keeps writing at the version
  // whose canonical rows were minted under this rule.
  const person: Omit<Person, "person_hash_id"> = {
    first: stripNamePartPunctuation(results.first) ?? results.first,
    middle: stripNamePartPunctuation(results.middle),
    last: stripNamePartPunctuation(results.last) ?? results.last,
    suffix: stripNamePartPunctuation(combineSuffixParts(results.generation, results.credential)),
    title: results.title,
    nick: emptyToNull(results.nick),
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
