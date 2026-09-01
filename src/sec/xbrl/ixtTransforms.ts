/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Minimal inline-XBRL transformation registry (ixt / ixt-sec) covering the
 * transforms SEC filings actually apply to facts this pipeline consumes.
 * Unknown transforms return null so callers keep the raw text and record the
 * format for later post-processing.
 */

/** Ballot-box glyphs used by ixt-sec:boolballotbox (checked => "true"). */
const BALLOT_CHECKED = /[☑☒]/; // ☑ ☒
const BALLOT_UNCHECKED = /☐/; // ☐

function numDotDecimal(text: string): string {
  // "1,234,567.89" -> "1234567.89"; also tolerates space/non-breaking-space grouping
  return text.replace(/[,\s  ]/g, "");
}

function numCommaDecimal(text: string): string {
  // "1.234.567,89" -> "1234567.89"
  return text.replace(/[.\s  ]/g, "").replace(/,/g, ".");
}

/** English month names / abbreviations -> 1..12 (used by the date transforms). */
const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function monthNumber(name: string): number | null {
  return MONTHS[name.toLowerCase().replace(/\.$/, "")] ?? null;
}

/** Formats real y/m/d parts as ISO-8601, or null for out-of-range/impossible dates. */
function toIsoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!Number.isInteger(year) || year < 1) return null;
  // Reject impossible calendar dates (e.g. Feb 30, Apr 31): a UTC round-trip
  // rolls an overflowing day into the next month, so the components no longer
  // match what was requested. Without this, "2/30/2024" would emit the invalid
  // ISO string "2024-02-30" instead of falling back to the raw text.
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    return null;
  }
  const pad = (n: number, width: number): string => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * The SEC date transforms normalize a locale-formatted date to ISO-8601. A
 * registered date transform that cannot parse its text falls back to the
 * trimmed raw text (not null): the fact is still a real date the filer typed,
 * just in an unexpected shape, so surfacing it beats blanking it.
 */
function dateMonthNameDayYear(text: string): string {
  // "September 3, 2024" / "Sept. 3 2024" / "September 03, 2024"
  const m = text.match(/([A-Za-z]+)\.?\s+(\d{1,2})\s*,?\s+(\d{4})/);
  const month = m ? monthNumber(m[1]) : null;
  return (m && month !== null && toIsoDate(Number(m[3]), month, Number(m[2]))) || text.trim();
}

function dateDayMonthNameYear(text: string): string {
  // "3 September 2024" / "03 Sept 2024"
  const m = text.match(/(\d{1,2})\s+([A-Za-z]+)\.?\s*,?\s+(\d{4})/);
  const month = m ? monthNumber(m[2]) : null;
  return (m && month !== null && toIsoDate(Number(m[3]), month, Number(m[1]))) || text.trim();
}

function dateMonthDayYear(text: string): string {
  // numeric "9/3/2024" / "09-03-2024" / "9.3.2024"
  const m = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return (m && toIsoDate(Number(m[3]), Number(m[1]), Number(m[2]))) || text.trim();
}

function dateDayMonthYear(text: string): string {
  // numeric "3/9/2024" / "03-09-2024"
  const m = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return (m && toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]))) || text.trim();
}

function dateYearMonthDay(text: string): string {
  // numeric "2024/9/3" / "2024-09-03"
  const m = text.match(/(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})/);
  return (m && toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]))) || text.trim();
}

const TRANSFORMS: Record<string, (text: string) => string> = {
  "num-dot-decimal": numDotDecimal,
  numdotdecimal: numDotDecimal,
  "num-comma-decimal": numCommaDecimal,
  numcommadecimal: numCommaDecimal,
  "zero-dash": () => "0",
  zerodash: () => "0",
  "fixed-zero": () => "0",
  "fixed-empty": () => "",
  nocontent: () => "",
  "fixed-true": () => "true",
  "fixed-false": () => "false",
  booleantrue: () => "true",
  booleanfalse: () => "false",
  boolballotbox: (text) =>
    BALLOT_CHECKED.test(text) ? "true" : BALLOT_UNCHECKED.test(text) ? "false" : text.trim(),
  // Dates -> ISO-8601. Both the TR1 concatenated names ("datemonthdayyearen")
  // and the TR3/TR4 hyphenated names ("date-monthname-day-year-en") appear
  // across filing vintages, so register both spellings.
  "date-monthname-day-year-en": dateMonthNameDayYear,
  "date-monthname-day-year": dateMonthNameDayYear,
  datemonthdayyearen: dateMonthNameDayYear,
  "date-day-monthname-year-en": dateDayMonthNameYear,
  "date-day-monthname-year": dateDayMonthNameYear,
  datedaymonthyearen: dateDayMonthNameYear,
  "date-month-day-year": dateMonthDayYear,
  dateslashus: dateMonthDayYear, // TR1 US numeric slash form (M/D/Y)
  "date-day-month-year": dateDayMonthYear,
  dateslasheu: dateDayMonthYear, // TR1 EU numeric slash form (D/M/Y)
  "date-year-month-day": dateYearMonthDay,
  dateyearmonthday: dateYearMonthDay,
};

/**
 * Applies a registered ixt/ixt-sec transform (matched by local name, prefix
 * ignored) to trimmed text. Returns null when the transform is not registered.
 */
export function applyIxtTransform(format: string | null, text: string): string | null {
  const trimmed = text.trim();
  if (format === null || format.length === 0) return trimmed;
  const local = format.includes(":") ? format.slice(format.indexOf(":") + 1) : format;
  const fn = TRANSFORMS[local.toLowerCase()];
  return fn ? fn(trimmed) : null;
}
