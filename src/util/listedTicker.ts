/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

const WRAP_CHARS = /(?:^[\s*]+)|(?:[\s*]+$)/g;

/** Longest first so OTCBB wins over OTC and NYSEAMER wins over NYSE. */
const EXCHANGE_NAMES = [
  "OTCBB",
  "OTCQB",
  "OTCQX",
  "NYSEAMER",
  "NYSEARCA",
  "NASDAQ",
  "NYSE",
  "AMEX",
  "BATS",
  "CBOE",
  "OTC",
] as const;

const DELIMITERS = new Set([":", "-", "_", " "]);

const PLACEHOLDERS = new Set([
  "N/A",
  "NA",
  "NONE",
  "NOT AVAIL.",
  "NOT AVAILABLE",
  "NOT APPLICABLE",
  "-",
  "--",
]);

/**
 * A listed symbol: a root plus at most one class/series suffix.
 *
 * The suffix separator is `.` OR `-`, and the root admits digits, because EDGAR
 * is the authority on both and uses them. The submissions API states a
 * multi-class filer's symbols hyphenated (`BRK-A`, `BRK-B`, `HEI-A`, `LEN-B`),
 * so a dot-only, letters-only form rejected every one of them — and this
 * function's callers treat a rejection as "not a ticker" and drop the row, so a
 * class share simply stopped being stored. The suffix vocabulary is likewise
 * open (`A`, `B`, `U`, `WS`, `RT`, ...) rather than the four unit-split codes:
 * a share class is not a warrant, and enumerating only the SPAC codes reads
 * every other class as junk.
 */
const LISTED_FORM = /^[A-Z0-9]{1,5}(?:[.-][A-Z]{1,3}|[UWR]| [A-Z]{1,3})?$/;

function stripExchangePrefix(token: string): string {
  for (const name of EXCHANGE_NAMES) {
    if (token.length <= name.length) continue;
    if (!token.startsWith(name)) continue;
    const next = token.charAt(name.length);
    if (!DELIMITERS.has(next)) continue;
    let rest = token.slice(name.length);
    while (rest.length > 0 && DELIMITERS.has(rest.charAt(0))) {
      rest = rest.slice(1);
    }
    return rest;
  }
  return token;
}

/**
 * Strip wrappers, placeholders, and delimited exchange prefixes. Returns the
 * listed symbol or null when nothing listed remains. Does not rewrite a listed
 * class suffix (`GSAH.U` stays `GSAH.U`).
 */
export function normalizeListedTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let token = raw.replace(WRAP_CHARS, "").toUpperCase();
  if (token.startsWith("(") && token.endsWith(")") && token.length >= 2) {
    token = token.slice(1, -1).replace(WRAP_CHARS, "");
  }
  token = stripExchangePrefix(token);
  if (token === "" || PLACEHOLDERS.has(token)) return null;
  if (!LISTED_FORM.test(token)) return null;
  return token;
}

/** Map, drop nulls, and keep first-seen unique cleaned symbols. */
export function cleanListedTickers(raw: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const ticker = normalizeListedTicker(item);
    if (ticker === null || seen.has(ticker)) continue;
    seen.add(ticker);
    out.push(ticker);
  }
  return out;
}
