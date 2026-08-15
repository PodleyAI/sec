/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Headline offering size printed on a priced 424B1/424B4 cover:
 * `$200,000,000` / `20,000,000 Units`. That figure is not inside "The Offering"
 * section the AI extractor is handed, so a wiped unit-terms row still has a
 * deterministic source for IPO proceeds.
 */
export interface PricedProspectusCover {
  readonly gross_proceeds: number;
  readonly units_offered: number;
}

/** Smallest SPAC IPO unit count we will take from a cover headline. */
const MIN_UNITS = 1_000_000;
/** Smallest headline dollar size; warrant strikes and working-capital caps sit below this. */
const MIN_PROCEEDS = 10_000_000;
const COVER_CHARS = 4000;
/** SPAC units price at $10.00; a 8–12 band rejects a coincidental large dollar. */
const MIN_PER_UNIT = 8;
const MAX_PER_UNIT = 12;

const COMMA_NUMBER = String.raw`[0-9]{1,3}(?:,[0-9]{3})+`;

function htmlToCoverText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/&#x0*a0;|&#160;|&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The cover headline sits before the "This is an initial public offering"
 * paragraph. Cutting there keeps warrant strikes, overallotment options, and
 * the $1,000,000 working-capital cap out of the parse.
 */
function coverPrefix(text: string): string {
  const cut = text.search(/This is an initial public offering/i);
  if (cut >= 0) return text.slice(0, cut);
  return text.slice(0, COVER_CHARS);
}

export function parsePricedProspectusCover(html: string): PricedProspectusCover | null {
  const prefix = coverPrefix(htmlToCoverText(html));
  const unitsMatch = prefix.match(new RegExp(String.raw`\b(${COMMA_NUMBER})\s+Units\b`, "i"));
  if (unitsMatch?.index == null) return null;
  const units_offered = Number(unitsMatch[1].replaceAll(",", ""));
  if (!Number.isFinite(units_offered) || units_offered < MIN_UNITS) return null;

  const before = prefix.slice(0, unitsMatch.index);
  let gross_proceeds: number | null = null;
  for (const m of before.matchAll(new RegExp(String.raw`\$\s*(${COMMA_NUMBER})(?:\.\d+)?`, "g"))) {
    const n = Number(m[1].replaceAll(",", ""));
    if (Number.isFinite(n) && n >= MIN_PROCEEDS) gross_proceeds = n;
  }
  if (gross_proceeds == null) return null;

  const perUnit = gross_proceeds / units_offered;
  if (perUnit < MIN_PER_UNIT || perUnit > MAX_PER_UNIT) return null;

  return { gross_proceeds, units_offered };
}
