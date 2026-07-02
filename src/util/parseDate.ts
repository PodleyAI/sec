/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { Format } from "typebox/format";

/**
 * Parses a date string into a year, month, and day.
 *
 * @param dateStr - The date string to parse.
 * @returns The parsed date, separated into year, month, and day.
 */
export function parseDate(dateStr: string): { year: number; month: string; day: string } {
  const regexes = [
    /^(\d{4})-(\d{1,2})-(\d{1,2})$/, // yyyy-MM-dd
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, // MM/dd/yyyy
    /^(\d{1,2})-(\d{1,2})-(\d{4})$/, // MM-dd-yyyy
    /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/, // yyyy/MM/dd
    /^(\d{4})(\d{2})(\d{2})$/, // yyyyMMdd (EDGAR index filenames)
  ];

  for (const regex of regexes) {
    const match = dateStr.match(regex);
    if (match) {
      let year: number, month: number, day: number;

      if (regex === regexes[0] || regex === regexes[3] || regex === regexes[4]) {
        // year-first: yyyy-MM-dd, yyyy/MM/dd, or yyyyMMdd
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
      } else {
        // month-first: MM/dd/yyyy or MM-dd-yyyy
        year = parseInt(match[3], 10);
        month = parseInt(match[1], 10);
        day = parseInt(match[2], 10);
      }

      // The shapes above only constrain digit counts, so "20251301" (month 13)
      // or "2025-00-45" pass the regex but are not real dates. Reject
      // out-of-range months/days rather than silently emitting "13"/"45", which
      // would corrupt date ordering and as_of guards downstream.
      if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new Error("Invalid date format");
      }

      // Range-valid but calendar-invalid dates (Feb 30, Feb 29 in non-leap
      // years, Apr/Jun/Sep/Nov 31) would otherwise flow through as-is and
      // silently roll forward when downstream code hands the string to
      // `new Date(...)` — shifting point-in-time semantics of ChangeLog /
      // spac_history / offering-history rows. Probe via a UTC Date and reject
      // any input the calendar refused to preserve.
      const probe = new Date(Date.UTC(year, month - 1, day));
      // `Date.UTC` remaps years 0-99 to 1900-1999; `setUTCFullYear` does not,
      // so restore the literal year before comparing — otherwise a valid
      // 4-digit year like "0099" would be wrongly rejected. A Feb-30-style
      // rollover still surfaces in the month/day fields, which this leaves
      // untouched.
      probe.setUTCFullYear(year);
      if (
        probe.getUTCFullYear() !== year ||
        probe.getUTCMonth() !== month - 1 ||
        probe.getUTCDate() !== day
      ) {
        throw new Error(`Invalid calendar date: ${dateStr}`);
      }

      return {
        year,
        month: month.toString().padStart(2, "0"),
        day: day.toString().padStart(2, "0"),
      };
    }
  }

  throw new Error("Invalid date format");
}

/**
 * Converts a date to a SEC date format.
 *
 * @param date - The date to convert.
 * @returns The SEC date format YYYY-MM-DD
 */
export function secDate(date: Date): string;
export function secDate(date: string): string;
export function secDate(date: Date | string): string {
  if (date instanceof Date) {
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date
      .getDate()
      .toString()
      .padStart(2, "0")}`;
  }
  const { year, month, day } = parseDate(date);
  return `${year}-${month}-${day}`;
}

// export const TypeDateTime = (annotations: Record<string, unknown> = {}) =>
//   Type.String({ format: "sec-date-time", ...annotations });

Format.Set("sec-date", (value: string): boolean => {
  return /^(\d{4})-(\d{2})-(\d{2})$/.test(value);
});
export const TypeSecDate = (annotations: Record<string, unknown> = {}) =>
  Type.String({ format: "sec-date", ...annotations });

export const TypeOptionalSecDate = (annotations: Record<string, unknown> = {}) =>
  Type.Optional(TypeSecDate({ default: "", ...annotations }));

export type YYYYdMMdDD = Static<ReturnType<typeof TypeSecDate>>;
export type OptionalFullDateString = YYYYdMMdDD | "";
