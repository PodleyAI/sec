/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { ENTITY_TICKER_REPOSITORY_TOKEN } from "../storage/entity/EntityTickerSchema";
import { queryCiks } from "./queries/CikQuery";

export interface CompanyCandidate {
  readonly cik: number;
  readonly name: string;
}

export type CompanyRef =
  | { readonly kind: "resolved"; readonly cik: number; readonly name: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly CompanyCandidate[] }
  /** `cik_names` is empty, so a name or ticker cannot be looked up at all. */
  | { readonly kind: "no-index" }
  | { readonly kind: "not-found"; readonly input: string };

/** How many candidates an ambiguous answer offers before it stops listing. */
const MAX_CANDIDATES = 10;

/** A CIK written any of the ways EDGAR writes one: `320193`, `0000320193`. */
function asCik(input: string): number | undefined {
  if (!/^\d{1,10}$/.test(input)) return undefined;
  const cik = Number(input);
  return cik > 0 ? cik : undefined;
}

/**
 * A ticker, by shape. EDGAR tickers are short and upper-case; a longer or
 * mixed-case string is a name, and probing the ticker table for it costs a scan
 * that can never match.
 */
function looksLikeTicker(input: string): boolean {
  return /^[A-Z][A-Z.-]{0,7}$/.test(input);
}

async function cikForTicker(ticker: string): Promise<number | undefined> {
  const repo = globalServiceRegistry.get(ENTITY_TICKER_REPOSITORY_TOKEN);
  const rows = (await repo.query({ ticker })) ?? [];
  return rows.length > 0 ? Number(rows[0]!.cik) : undefined;
}

/**
 * Turns whatever a person typed into one company, or into the reason it could
 * not be one.
 *
 * A CIK, a ticker, or a name — in that order, because each is unambiguous where
 * the next is not. Ambiguity is never guessed past: two companies whose names
 * both contain "apple" is a question for the caller, and answering it by taking
 * the first row is how a command quietly fetches the wrong filer.
 */
export async function resolveCompany(input: string): Promise<CompanyRef> {
  const trimmed = input.trim();
  if (trimmed === "") return { kind: "not-found", input };

  const cik = asCik(trimmed);
  if (cik !== undefined) return { kind: "resolved", cik, name: `CIK ${cik}` };

  if (looksLikeTicker(trimmed.toUpperCase()) && trimmed.length <= 8) {
    const byTicker = await cikForTicker(trimmed.toUpperCase());
    if (byTicker !== undefined) {
      return { kind: "resolved", cik: byTicker, name: trimmed.toUpperCase() };
    }
  }

  const { rows, tableEmpty } = await queryCiks({ name: trimmed, limit: MAX_CANDIDATES });
  if (tableEmpty) return { kind: "no-index" };
  if (rows.length === 0) return { kind: "not-found", input: trimmed };

  const named = rows.map((row) => ({ cik: Number(row.cik), name: row.name ?? `CIK ${row.cik}` }));
  // An exact name match settles it even when substrings also matched: "Apple
  // Inc." should not be ambiguous because "Apple Hospitality REIT" exists.
  const exact = named.filter((row) => row.name.toLowerCase() === trimmed.toLowerCase());
  if (exact.length === 1) return { kind: "resolved", ...exact[0]! };
  if (named.length === 1) return { kind: "resolved", ...named[0]! };
  return { kind: "ambiguous", candidates: named };
}

/**
 * The message a caller prints when resolution did not produce one company.
 *
 * Phrased as the next command to run, not as a complaint: every branch here is
 * something the reader can act on, and saying which action is the whole point.
 */
export function describeUnresolved(ref: Exclude<CompanyRef, { kind: "resolved" }>): string {
  if (ref.kind === "no-index") {
    return (
      "No company list loaded yet, so a name or ticker cannot be looked up.\n" +
      "  Run `sec load download ciks` (8 MB, about 30 seconds), or pass a CIK directly."
    );
  }
  if (ref.kind === "not-found") {
    return `No company matches "${ref.input}". Try a CIK, a ticker, or fewer words.`;
  }
  const lines = ref.candidates.map((row) => `  ${String(row.cik).padStart(10)}  ${row.name}`);
  return `Several companies match. Re-run with one of these CIKs:\n${lines.join("\n")}`;
}
