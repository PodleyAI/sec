/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { decode } from "html-entities";

export const companyPrefixnameRegExp =
  /^(?<prefix>(\(?Managing Partner|Managing Member|Partner|General Partner\)?)\s+(of the Issuer|of Issuer|of (the )?General Partner)?)\b/i;
export const companyPostfixnameRegExp =
  /\b(?<postfix>(\(?Managing Partner|Managing Member|Partner|General Partner\)?)(\s+(of the Issuer|of Issuer|of (the )?General Partner))?)$/i;

/**
 * Maps typographic (Unicode) punctuation to its plain-ASCII equivalent. Models
 * and filings emit smart quotes, curly apostrophes, primes, and en/em/figure
 * dashes interchangeably; folding them to ASCII keeps normalized identity keys
 * (person/company names) stable regardless of which glyph a source used.
 */
const TYPOGRAPHIC_PUNCTUATION: Readonly<Record<string, string>> = {
  // Single quotes / apostrophes / primes -> '
  "‘": "'", // ‘ left single
  "’": "'", // ’ right single (curly apostrophe)
  "‚": "'", // ‚ single low-9
  "‛": "'", // ‛ single high-reversed-9
  ʼ: "'", // ʼ modifier letter apostrophe
  "′": "'", // ′ prime
  "‵": "'", // ‵ reversed prime
  // Double quotes / primes -> "
  "“": '"', // “ left double
  "”": '"', // ” right double
  "„": '"', // „ double low-9
  "‟": '"', // ‟ double high-reversed-9
  "″": '"', // ″ double prime
  "‶": '"', // ‶ reversed double prime
  // Dashes / minus -> -
  "‐": "-", // ‐ hyphen
  "‑": "-", // ‑ non-breaking hyphen
  "‒": "-", // ‒ figure dash
  "–": "-", // – en dash
  "—": "-", // — em dash
  "―": "-", // ― horizontal bar
  "−": "-", // − minus sign
};

const TYPOGRAPHIC_PUNCTUATION_RE = new RegExp(
  `[${Object.keys(TYPOGRAPHIC_PUNCTUATION).join("")}]`,
  "g"
);

/**
 * Folds typographic punctuation (smart quotes, curly apostrophes, primes,
 * en/em dashes) to plain ASCII. Idempotent and safe on plain ASCII input.
 */
export function foldTypographicPunctuation(s: string): string {
  return s.replace(TYPOGRAPHIC_PUNCTUATION_RE, (c) => TYPOGRAPHIC_PUNCTUATION[c]);
}

/**
 * Latin letters that carry their mark INSIDE the glyph, so Unicode has no
 * combining-mark form to strip. `Ø` does not decompose the way `Ö` does, which
 * is why NFD alone is not a diacritic fold: it silently leaves these untouched,
 * and a downstream `[^a-z]` filter then deletes the letter or turns it into a
 * word break. `Łukasz` losing its `Ł` is not a normalization, it is a different
 * name.
 *
 * Expansions (`æ` → `ae`) follow the convention the filer's own romanized
 * spelling uses when EDGAR carries both.
 */
const NON_DECOMPOSING_LATIN: Record<string, string> = {
  ø: "o",
  œ: "oe",
  æ: "ae",
  ł: "l",
  đ: "d",
  ð: "d",
  þ: "th",
  ß: "ss",
  ħ: "h",
  ı: "i",
  ŋ: "n",
  ŧ: "t",
  ƶ: "z",
};

const NON_DECOMPOSING_LATIN_RE = new RegExp(
  `[${Object.keys(NON_DECOMPOSING_LATIN).join("")}]`,
  "g"
);

/**
 * Folds accented Latin letters to their ASCII base: `Jörg Müller` and
 * `Jorg Muller` become the same string, as do `Søren` and `Soren`.
 *
 * Two passes, because one does not cover the alphabet: NFD splits a letter from
 * its combining mark so the mark can be dropped, and the map above handles the
 * letters that have no such split. Lowercases as part of folding, since every
 * caller wants a case-insensitive key.
 *
 * Idempotent and safe on plain ASCII.
 */
export function foldDiacritics(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(NON_DECOMPOSING_LATIN_RE, (c) => NON_DECOMPOSING_LATIN[c]);
}

/**
 * Returns today's date in YYYY-MM-DD format
 */
export function todayYYYYdMMdDD(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Cleans HTML document by decoding entities, normalizing whitespace, and extracting text content
 */
export function cleanHtmlDoc(html: string): string {
  const doc = decode(html)
    .replaceAll("\xA0", " ")
    .replaceAll(" \n", " ")
    .replaceAll(/\n+/g, " ")
    .replaceAll(/[       ]+/g, " ");
  return doc.substring(doc.indexOf("<TEXT>") + 6);
}
