/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import type { UseOfProceedsLineRow } from "./useOfProceedsSchema";

const MIN_LINES = 2;
const MIN_AMOUNT = 1_000;
/**
 * Total, source, subtotal and ratio rows — the table's own arithmetic rather
 * than a use of the proceeds. Every one is anchored to the START of the label:
 * each of these phrases also occurs inside a real line item's parenthetical
 * qualifier, which is how most filers write the largest expense row in the
 * table ("Underwriting commissions (2.0% of gross proceeds from units offered
 * to public)") and the residual trust row ("Not held in trust account after
 * offering expenses"). A label opening with `%` states a ratio of the offering
 * ("% of public offering size"), never a use of it.
 */
const SKIP_LEADING =
  /^(?:gross proceeds|proceeds from\b|from\b|totals?\b|proceeds after|%|(?:estimated )?offering expenses\b(?! \()|revenues?\b|cost of sales\b|gross profit\b|operating loss\b|net loss\b|ebitda\b|adjusted ebitda\b|net cash\b)/i;

/**
 * Per-unit metric rows from a dilution or capitalization table that leaked into
 * the section. Tested against the label with parentheticals removed, because a
 * real line item states its rate as a qualifier ("Held in trust account ($10.20
 * per unit)") while a metric row names the rate as the row itself.
 */
const SKIP_METRIC = /per (?:public )?share\b|per unit\b/i;

/**
 * A label carrying no figure heads the block beneath it. A filer who factors
 * the sources out into such a block writes its children bare — `Offering`,
 * `Private Units` — so only the heading says they are where the money came
 * from rather than where it goes. The matching `Offering expenses` heading
 * closes the block again, and its children are the real line items.
 */
const SOURCE_BLOCK_HEADING = /^(?:gross proceeds|proceeds\b|sources? of (?:funds|proceeds)\b)/i;
const DATE_PURPOSE =
  /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}$|^\d{4}$/i;
const SPAC_USE = /held in trust|not held in trust|underwriting discounts?|deferred underwriting/i;

export function parseSpacUseOfProceeds(text: string): UseOfProceedsLineRow[] {
  try {
    return parseInner(text).rows;
  } catch {
    return [];
  }
}

/**
 * Whether {@link parseSpacUseOfProceeds} enumerated the whole table, which is
 * what lets it stand in for the model on a destination the caller has already
 * emptied. It is the walk's own decline log, not a second reading of the
 * section: a labelled row BETWEEN the first and last line item, carrying no
 * figure this walk could read and matching none of the declared total / source
 * / ratio rules, is a row the parse could not represent.
 *
 * A filer who prints the trust amount only in prose leaves that row's figure
 * cells empty ("Held in trust account(3)" against a "% of public offering size"
 * of 100.0), and the disclosure is the row. A sub-table heading inside one grid
 * reads identically, so this errs toward incomplete — which costs a model call
 * rather than a filed line item.
 */
export function useOfProceedsIsComplete(text: string): boolean {
  try {
    const { rows, unrepresented } = parseInner(text);
    return rows.length > 0 && unrepresented === 0;
  } catch {
    return false;
  }
}

interface UseOfProceedsParse {
  readonly rows: UseOfProceedsLineRow[];
  /** Labelled rows inside the line-item span that the walk could not represent. */
  readonly unrepresented: number;
}

const EMPTY_PARSE: UseOfProceedsParse = { rows: [], unrepresented: 0 };

function parseInner(text: string): UseOfProceedsParse {
  const parsed = collectLines(text);
  if (parsed.rows.length < MIN_LINES) return EMPTY_PARSE;
  if (!parsed.rows.some((r) => SPAC_USE.test(r.purpose ?? ""))) return EMPTY_PARSE;
  return parsed;
}

/** True when a SPAC expense/trust table is present, even if parse would return []. */
export function hasSpacUseOfProceedsTable(text: string): boolean {
  return collectLines(text).rows.some((r) => SPAC_USE.test(r.purpose ?? ""));
}

function collectLines(text: string): UseOfProceedsParse {
  const out: UseOfProceedsLineRow[] = [];
  let unrepresented = 0;
  for (const table of splitGfmTables(text)) {
    let inSourceBlock = false;
    let firstItem = -1;
    let lastItem = -1;
    // Row index of each unclassified figure-less label, resolved against the
    // line-item span only once the table has been walked to its end.
    const declined: number[] = [];
    for (let i = 0; i < table.length; i++) {
      const row = table[i]!;
      const cells = row.map(cleanCell).filter((c, j, arr) => !(c === "" && j > 0 && arr[0] === ""));
      const purposeRaw = cells.find((c) => c !== "" && c !== "$" && c !== "%") ?? "";
      const purpose = tidyPurpose(purposeRaw);
      if (purpose === "") continue;
      const amount = firstAmount(cells);
      if (amount === null) {
        inSourceBlock = SOURCE_BLOCK_HEADING.test(purpose);
        if (!isSkipPurpose(purpose) && !DATE_PURPOSE.test(purpose) && !isHeaderRow(cells)) {
          declined.push(i);
        }
        continue;
      }
      if (
        inSourceBlock ||
        isSkipPurpose(purpose) ||
        DATE_PURPOSE.test(purpose) ||
        isHeaderRow(cells)
      ) {
        continue;
      }
      if (!text.includes(purposeRaw) && !text.includes(purpose)) {
        declined.push(i);
        continue;
      }
      if (firstItem < 0) firstItem = i;
      lastItem = i;
      const percent = firstPercent(cells);
      out.push({
        purpose,
        amount,
        percent,
        note: null,
        confidence: 1,
        source_span: purposeRaw,
        source: "deterministic",
      });
    }
    unrepresented += declined.filter((i) => i > firstItem && i < lastItem).length;
  }
  return { rows: out, unrepresented };
}

function isSkipPurpose(purpose: string): boolean {
  if (SKIP_LEADING.test(purpose)) return true;
  return SKIP_METRIC.test(purpose.replace(/\([^()]*\)/g, " "));
}

function isHeaderRow(cells: readonly string[]): boolean {
  const blob = cells.join(" ").toLowerCase();
  return /without over|with over|amount|gross proceeds/.test(blob) && !/\d{3,}/.test(blob);
}

function tidyPurpose(raw: string): string {
  return raw
    .replace(/\(\d+\)/g, "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function firstAmount(cells: readonly string[]): number | null {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    if (c === "" || c === "$" || c === "%") continue;
    if (cells[i + 1] === "%") continue;
    const n = parseNumeric(c.replace(/,/g, ""));
    if (n !== undefined && Number.isFinite(n) && n >= MIN_AMOUNT) return n;
  }
  return null;
}

function firstPercent(cells: readonly string[]): number | null {
  for (let i = 0; i < cells.length; i++) {
    if (cells[i + 1] !== "%") continue;
    const n = parseNumeric(cells[i]!.replace(/,/g, ""));
    if (n !== undefined && Number.isFinite(n)) return n;
  }
  return null;
}

function cleanCell(raw: string): string {
  return raw
    .replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitGfmTables(text: string): string[][][] {
  const tables: string[][][] = [];
  let current: string[][] = [];
  const flush = (): void => {
    if (current.length > 0) tables.push(current);
    current = [];
  };
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      flush();
      continue;
    }
    if (isSeparatorRow(trimmed)) continue;
    current.push(splitPipeRow(trimmed).map(cleanCell));
  }
  flush();
  return tables;
}

function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line) || /^[\s|:-]+$/.test(line);
}

function splitPipeRow(line: string): string[] {
  const inner = line.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cur += "|";
      i += 1;
      continue;
    }
    if (inner[i] === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += inner[i];
  }
  cells.push(cur);
  return cells;
}
