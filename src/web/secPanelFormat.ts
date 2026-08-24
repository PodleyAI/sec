/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PanelData, WebTone } from "@workglow/cli";

/**
 * Shared rendering for sec's panels.
 *
 * A panel's job is to make a stored row readable, and the same handful of
 * questions come up in every one: how do you print a dollar figure nobody can
 * count the digits of, what does a null mean, and how do you turn an array of
 * records into a table without hand-listing its columns for the fifteenth time.
 */

/** Money as a filing states it: a scale suffix, because 1400000000 reads as nothing. */
export function money(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

export function count(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

/** A null is a null. Printing "null" or "" invites reading it as a zero. */
export function text(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** The JSON-encoded string arrays several spac columns carry. */
export function jsonList(value: unknown): string {
  if (typeof value !== "string" || value === "") return "—";
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(String).join(", ") : "—";
  } catch {
    return value;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads one field off an unknown output without narrowing the whole shape. */
export function field(output: unknown, key: string): unknown {
  return isRecord(output) ? output[key] : undefined;
}

export function recordArray(value: unknown): readonly Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * A table over an array of records, with the columns taken from the rows.
 *
 * Columns are the union of every row's keys in first-seen order, so a row that
 * carries an extra field does not silently lose it — and a column every row
 * leaves null is dropped, since a query result padded with a dozen empty
 * columns is harder to read than one without them.
 */
export function tableFromRecords(
  rows: readonly Record<string, unknown>[],
  options: {
    readonly limit?: number;
    readonly columns?: readonly string[];
    readonly tone?: (row: Record<string, unknown>) => WebTone | undefined;
    readonly note?: string;
  } = {}
): PanelData {
  const limit = options.limit ?? 100;
  if (rows.length === 0) return { kind: "empty", message: "No rows." };

  const columns =
    options.columns ??
    [...new Set(rows.flatMap((row) => Object.keys(row)))].filter((key) =>
      rows.some((row) => row[key] !== null && row[key] !== undefined && row[key] !== "")
    );

  const shown = rows.slice(0, limit);
  const truncated =
    rows.length > shown.length ? `${rows.length - shown.length} more not shown` : "";
  const note = [options.note, truncated].filter(Boolean).join(" · ");

  return {
    kind: "table",
    columns: [...columns],
    rows: shown.map((row) => columns.map((column) => text(row[column]))),
    ...(options.tone ? { rowTones: shown.map((row) => options.tone?.(row)) } : {}),
    ...(note ? { note } : {}),
  };
}
