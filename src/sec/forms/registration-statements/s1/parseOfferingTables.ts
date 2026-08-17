/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import { anchorFieldSpan } from "./anchorFieldSpan";
import type { OfferingTermsRow } from "./offeringTermsSchema";
import type { SponsorPromoteRow } from "./sponsorPromoteSchema";

export const DETERMINISTIC_MODEL_ID = "deterministic";

const PRICE_MIN = 8;
const PRICE_MAX = 12;

const PLACEHOLDER = /^(?:\[●\]|●|\[•\]|•|—|–|-|\*|\u25cf)?$/;

export function parseSpacOfferingTerms(text: string): OfferingTermsRow | null {
  const fields = walkOfferingFields(text);
  if (fields.price_per_unit === null || fields.units_offered === null) return null;
  if (!locates(text, fields.price_per_unit, "per unit")) return null;
  if (!locates(text, fields.units_offered, "units")) return null;
  const source_span = fields.source_span;
  if (source_span === "" || !text.includes(source_span)) return null;
  return offeringRow(fields, source_span);
}

export function parseSpacPromoteTerms(_text: string): SponsorPromoteRow | null {
  return null;
}

export function looksLikeUnitIpo(text: string): boolean {
  const fields = walkOfferingFields(text);
  return fields.price_per_unit !== null || fields.units_offered !== null;
}

interface OfferingWalk {
  price_per_unit: number | null;
  units_offered: number | null;
  source_span: string;
}

function walkOfferingFields(text: string): OfferingWalk {
  let price_per_unit: number | null = null;
  let units_offered: number | null = null;
  let source_span = "";
  for (const row of iterTableRows(text)) {
    if (price_per_unit === null && isPriceLabel(row.label)) {
      const n = firstMoney(row.value);
      if (n !== undefined && n >= PRICE_MIN && n <= PRICE_MAX) {
        price_per_unit = n;
        if (source_span === "") source_span = row.value;
      }
    }
    if (units_offered === null && isUnitsOfferedLabel(row.label)) {
      const n = firstInteger(row.value);
      if (n !== undefined) {
        units_offered = n;
        if (source_span === "") source_span = row.value;
      }
    }
  }
  return { price_per_unit, units_offered, source_span };
}

function locates(text: string, value: number, label: string): boolean {
  return anchorFieldSpan(text, value, label) !== null;
}

function offeringRow(fields: OfferingWalk, source_span: string): OfferingTermsRow {
  return {
    security_type: null,
    shares_offered: null,
    price: null,
    price_low: null,
    price_high: null,
    gross_proceeds: null,
    net_proceeds: null,
    over_allotment_shares: null,
    units_offered: fields.units_offered,
    price_per_unit: fields.price_per_unit,
    unit_composition: null,
    warrant_fraction_per_unit: null,
    right_fraction_per_unit: null,
    trust_per_unit: null,
    over_allotment_units: null,
    exchange: null,
    par_value: null,
    confidence: 1,
    source_span,
    tickers: [],
    source: "deterministic",
  };
}

interface TableRow {
  readonly label: string;
  readonly value: string;
}

function iterTableRows(text: string): TableRow[] {
  const rows: TableRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (isSeparatorRow(trimmed)) continue;
    const cells = splitPipeRow(trimmed);
    if (cells.length < 2) continue;
    const label = normalizeLabel(cells[0] ?? "");
    const value = (cells[1] ?? "").trim();
    if (label === "" || isPlaceholder(value)) continue;
    rows.push({ label, value });
  }
  return rows;
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
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += inner[i];
  }
  cells.push(cur.trim());
  return cells;
}

function normalizeLabel(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\(\d+\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlaceholder(value: string): boolean {
  return PLACEHOLDER.test(value.trim());
}

function isPriceLabel(label: string): boolean {
  return /offering price|price per unit/.test(label);
}

function isUnitsOfferedLabel(label: string): boolean {
  if (/outstanding after/.test(label)) return false;
  return /number of units offered|units offered|^securities offered$/.test(label);
}

function firstMoney(cell: string): number | undefined {
  const m = cell.match(/\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (m) return parseNumeric(m[0]);
  return firstNumber(cell);
}

function firstInteger(cell: string): number | undefined {
  const n = firstNumber(cell);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
}

function firstNumber(cell: string): number | undefined {
  const m = cell.match(/(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  return parseNumeric(m[1]);
}
