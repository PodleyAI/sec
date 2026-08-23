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

const LISTED_FORM = /^[A-Z]{1,5}(?:\.(?:U|WS|WT|RT)|[UWR]| [A-Z]{1,3})?$/;

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
  if (token === "" || PLACEHOLDERS.has(token) || /^_+$/.test(token)) return null;
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
