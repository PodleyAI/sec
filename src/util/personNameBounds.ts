/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Cap on a person display name. Matches the leader `party_slug` / list-leader
 * slug column: a longer string is a footnote, a sentence, or a company name
 * repeated across first/middle/last, not a person.
 */
export const MAX_PERSON_NAME_CHARS = 150;

/** Concatenate name parts the way leader slugs are built from display fields. */
export function joinedPersonName(
  first: string | null | undefined,
  middle: string | null | undefined,
  last: string | null | undefined,
  suffix: string | null | undefined = undefined
): string {
  return [first, middle, last, suffix].filter((part) => typeof part === "string" && part !== "").join(
    " "
  );
}

/** True when a name would overflow the leader-slug column. */
export function isOverlongPersonName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.trim().length > MAX_PERSON_NAME_CHARS;
}
