/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

export type TheNadas =
  | ""
  | "N/A"
  | "(N/A)"
  | "N//A"
  | "N?A"
  | "N.A"
  | "N.A."
  | "N/AQ"
  | "NONE"
  | "(NONE)"
  | "[NONE]"
  | "-"
  | "--"
  | "---"
  | "----"
  | "-----"
  | "------"
  | '"-"'
  | "."
  | ".."
  | "...";

export type TheConfused =
  | ","
  | '"'
  | "'"
  | "ETC"
  | "SAME"
  | '("ETC")'
  | "(SAME)"
  | "[SAME]"
  | "See Comments";

export type TheEntities =
  | "CORP"
  | "CORP."
  | "INC"
  | "INC."
  | "LLC"
  | "L.L.C."
  | "LTD"
  | "LTD."
  | "PTE LTD"
  | "GP"
  | "LP"
  | "(GP)"
  | "(LP)"
  | '("GP")'
  | '("LP")'
  | "Sponsor"
  | "(Sponsor)";

export type BadName = TheNadas | TheConfused | TheEntities;

/**
 * Lowercased, trimmed forms of values EDGAR filers commonly enter when they
 * have nothing real to put in a person/issuer name field. Each form parser
 * used to keep its own subtly different copy of this list; centralizing here
 * keeps the behaviour consistent across forms and easier to audit.
 */
const BAD_PERSON_FIELDS = new Set<string>([
  "",
  "n/a",
  "(n/a)",
  "n//a",
  "n?a",
  "n.a",
  "n.a.",
  "n/aq",
  "na",
  "none",
  "(none)",
  "[none]",
  "-",
  "--",
  "---",
  "----",
  "-----",
  "------",
  '"-"',
  ".",
  "..",
  "...",
  "....",
  "_",
  "__",
  "___",
  "____",
  ",",
  '"',
  "'",
  "etc",
  "same",
  '("etc")',
  "(same)",
  "[same]",
  "see comments",
  "managing member",
  "entity",
  "(entity)",
  "[entity]",
  "a delaware limited liability company",
]);

/**
 * Returns true when `field` is missing or matches a known placeholder/cruft
 * value that should be treated as "no real data" for person/issuer name fields.
 */
export function isBadPersonField(field: string | undefined | null): boolean {
  if (field === undefined || field === null) return true;
  const normalized = String(field).toLowerCase().trim();
  return BAD_PERSON_FIELDS.has(normalized);
}
