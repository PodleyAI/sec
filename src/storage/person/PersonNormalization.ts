/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseFullName } from "@sroussey/parse-full-name";
import { foldDiacritics, foldTypographicPunctuation } from "../../util/dataCleaningUtils";

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
   * Generational suffix ONLY — "Jr.", "Sr.", "III". This is identity-bearing:
   * a junior and a senior sharing a name are different people, so the suffix
   * belongs in {@link generatePersonHash} and in the resolver's match tuple.
   */
  suffix: string | null;
  /**
   * Professional credentials as written ("CPA", "Ph.D.", "M.D., CFA"), kept off
   * the identity key. A credential describes how ONE filing annotated a person,
   * not who they are — the same director is "Isaac Manke" in one filing and
   * "Isaac Manke, Ph.D." in the next — so folding it into the key split every
   * such person into two canonical rows.
   */
  credentials: string | null;
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
 * Generates a hash ID for a person based on normalized name components
 */
function generatePersonHash(person: Omit<Person, "person_hash_id">): string {
  // `nick` is deliberately absent: `normalizePerson` folds a nickname into
  // `middle` when there is no middle name, so including it here would spell
  // "Yong (David) Yan" as `yong-david-david-yan`. Listing exactly the parts the
  // resolver's match tuple uses also keeps this hash and `personKey` from
  // disagreeing about who is the same person — they did before, in both
  // directions.
  // Accents are already folded by `stripNamePartPunctuation`, so this hash and
  // the `normalized_*` columns `personKey` matches on agree by construction —
  // folding only here would recreate exactly the drift the note above warns of.
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
 *
 * Accents are folded here too, for the same reason and at the same cost: a
 * filer who writes "Jörg Müller" in one filing and "Jorg Muller" in the next is
 * naming one person, and without the fold the two spellings produced two
 * `person_hash_id`s AND two `normalized_*` tuples, so the resolver minted a
 * second canonical person. The company tier already folded, so the two tiers
 * disagreed about the same string.
 *
 * Only the IDENTITY parts pass through here. The name as the filing wrote it,
 * accents intact, is stored separately (`first_name` / `last_name` on the
 * observation) — this feeds the match columns, not the display ones.
 */
function stripNamePartPunctuation(part: string | null): string | null {
  if (part === null || part === undefined) return part ?? null;
  const cleaned = foldDiacritics(part).replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
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
  // `parseFullName` classifies the trailing parts itself — it owns the suffix
  // vocabulary, so it is the only place that can do this without the two lists
  // drifting apart. A credential is an annotation, not an identity, and must
  // reach neither the hash nor the resolver's match tuple, or the same director
  // splits in two the moment one filing writes "Isaac Manke, Ph.D." and the
  // next "Isaac Manke".
  // A parenthesized nickname is folded into `middle` when there is no middle
  // name, which is what puts it in the resolver's match tuple
  // (first|middle|last|suffix) — `nick` has no column there and so was being
  // dropped from identity entirely.
  //
  // It is treated as identity-bearing, not as an annotation like a credential,
  // because it frequently IS the only distinguishing signal. Across the very
  // common Chinese/Korean/Vietnamese given-name + surname pairs a filing roster
  // holds, "Yong Yan" is genuinely ambiguous while the adopted Western name is
  // not; discarding "(David)" merges people that the filing itself distinguishes.
  //
  // The cost is the mirror image, and it is real: a filing that prints the
  // nickname and an amendment that omits it now resolve to two canonical people
  // — the same over-splitting that keeping credentials off the key was meant to
  // avoid. That is bounded by `personKey` scoping the tuple to one issuer CIK,
  // so the merge this prevents and the split it risks both live inside a single
  // filer, where a roster's spelling is usually consistent.
  const parsedNick = emptyToNull(results.nick);
  const parsedMiddle = stripNamePartPunctuation(results.middle);
  const person: Omit<Person, "person_hash_id"> = {
    first: stripNamePartPunctuation(results.first) ?? foldDiacritics(results.first),
    middle: parsedMiddle ?? stripNamePartPunctuation(parsedNick),
    last: stripNamePartPunctuation(results.last) ?? foldDiacritics(results.last),
    suffix: stripNamePartPunctuation(emptyToNull(results.generation)),
    credentials: emptyToNull(results.credential),
    title: results.title,
    nick: parsedNick,
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
