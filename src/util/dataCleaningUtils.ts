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
  "ʼ": "'", // ʼ modifier letter apostrophe
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
