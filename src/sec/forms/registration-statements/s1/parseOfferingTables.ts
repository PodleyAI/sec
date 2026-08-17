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

const WORD_FRACTIONS: ReadonlyArray<{ readonly re: RegExp; readonly value: number }> = [
  { re: /\b(?:three[\s-]fourths?|3\/4)\b/i, value: 0.75 },
  { re: /\b(?:two[\s-]thirds?|2\/3)\b/i, value: 0.6667 },
  { re: /\b(?:one[\s-]half|1\/2)\b/i, value: 0.5 },
  { re: /\b(?:one[\s-]third|1\/3)\b/i, value: 0.3333 },
  { re: /\b(?:one[\s-]fourth|one[\s-]quarter|1\/4)\b/i, value: 0.25 },
  { re: /\b(?:one[\s-]fifth|1\/5)\b/i, value: 0.2 },
  { re: /\b(?:one[\s-]eighth|1\/8)\b/i, value: 0.125 },
  { re: /\b(?:one[\s-]tenth|1\/10)\b/i, value: 0.1 },
];

interface WalkedFields {
  price_per_unit: number | null;
  units_offered: number | null;
  trust_per_unit: number | null;
  warrant_fraction_per_unit: number | null;
  right_fraction_per_unit: number | null;
  unit_composition: string | null;
  over_allotment_units: number | null;
  gross_proceeds: number | null;
  exchange: string | null;
  founder_shares: number | null;
  founder_percent: number | null;
  private_placement_warrants: number | null;
  private_placement_warrant_price: number | null;
  trust_per_public_share: number | null;
  trust_total: number | null;
  source_span: string;
}

export function parseSpacOfferingTerms(text: string): OfferingTermsRow | null {
  const fields = walkFields(text);
  if (fields.price_per_unit === null || fields.units_offered === null) return null;
  if (!locates(text, fields.price_per_unit, "per unit")) return null;
  if (!locates(text, fields.units_offered, "units")) return null;
  const source_span = fields.source_span;
  if (source_span === "" || !text.includes(source_span)) return null;
  return {
    security_type: null,
    shares_offered: null,
    price: null,
    price_low: null,
    price_high: null,
    gross_proceeds: fields.gross_proceeds,
    net_proceeds: null,
    over_allotment_shares: null,
    units_offered: fields.units_offered,
    price_per_unit: fields.price_per_unit,
    unit_composition: fields.unit_composition,
    warrant_fraction_per_unit: fields.warrant_fraction_per_unit,
    right_fraction_per_unit: fields.right_fraction_per_unit,
    trust_per_unit: fields.trust_per_unit,
    over_allotment_units: fields.over_allotment_units,
    exchange: fields.exchange,
    par_value: null,
    confidence: 1,
    source_span,
    tickers: [],
    source: "deterministic",
  };
}

export function parseSpacPromoteTerms(text: string): SponsorPromoteRow | null {
  if (!looksLikeUnitIpo(text)) return null;
  const fields = walkFields(text);
  if (fields.founder_shares === null && fields.trust_per_public_share === null) return null;
  if (fields.founder_shares !== null && !locates(text, fields.founder_shares, "founder")) {
    return null;
  }
  if (
    fields.trust_per_public_share !== null &&
    !locates(text, fields.trust_per_public_share, "trust")
  ) {
    return null;
  }
  const source_span = fields.source_span;
  if (source_span === "" || !text.includes(source_span)) return null;
  return {
    founder_shares: fields.founder_shares,
    founder_percent: fields.founder_percent,
    private_placement_warrants: fields.private_placement_warrants,
    private_placement_warrant_price: fields.private_placement_warrant_price,
    public_warrant_coverage: fields.warrant_fraction_per_unit,
    trust_per_public_share: fields.trust_per_public_share,
    trust_total: fields.trust_total,
    confidence: 1,
    source_span,
    source: "deterministic",
  };
}

export function looksLikeUnitIpo(text: string): boolean {
  const fields = walkFields(text);
  return fields.price_per_unit !== null || fields.units_offered !== null;
}

function emptyWalk(): WalkedFields {
  return {
    price_per_unit: null,
    units_offered: null,
    trust_per_unit: null,
    warrant_fraction_per_unit: null,
    right_fraction_per_unit: null,
    unit_composition: null,
    over_allotment_units: null,
    gross_proceeds: null,
    exchange: null,
    founder_shares: null,
    founder_percent: null,
    private_placement_warrants: null,
    private_placement_warrant_price: null,
    trust_per_public_share: null,
    trust_total: null,
    source_span: "",
  };
}

function walkFields(text: string): WalkedFields {
  const out = emptyWalk();
  const take = (value: string): void => {
    if (out.source_span === "") out.source_span = value;
  };
  for (const row of iterTableRows(text)) {
    if (out.price_per_unit === null && isPriceLabel(row.label)) {
      const n = firstMoney(row.value);
      if (n !== undefined && n >= PRICE_MIN && n <= PRICE_MAX) {
        out.price_per_unit = n;
        take(row.value);
      }
    }
    if (out.units_offered === null && isUnitsOfferedLabel(row.label)) {
      const n = firstInteger(row.value);
      if (n !== undefined) {
        out.units_offered = n;
        take(row.value);
      }
    }
    if (isTrustLabel(row.label)) {
      if (out.trust_per_unit === null) {
        const per = perShareMoney(row.value);
        if (per !== undefined) {
          out.trust_per_unit = per;
          out.trust_per_public_share = out.trust_per_public_share ?? per;
          take(row.value);
        }
      }
      if (out.trust_total === null) {
        const total = headlineTotal(row.value);
        if (total !== undefined) {
          out.trust_total = total;
          take(row.value);
        }
      }
    }
    if (isCompositionLabel(row.label) || /consisting of/i.test(row.value)) {
      if (out.unit_composition === null) {
        const clause = compositionClause(row.value);
        if (clause !== null) {
          out.unit_composition = clause;
          take(row.value);
        }
      }
      if (out.warrant_fraction_per_unit === null) {
        const w = warrantFraction(row.value);
        if (w !== undefined) {
          out.warrant_fraction_per_unit = w;
          take(row.value);
        }
      }
      if (out.right_fraction_per_unit === null) {
        const r = rightFraction(row.value);
        if (r !== undefined) {
          out.right_fraction_per_unit = r;
          take(row.value);
        }
      }
    }
    if (out.over_allotment_units === null && /over-?allotment/.test(row.label)) {
      const n = firstInteger(row.value);
      if (n !== undefined) {
        out.over_allotment_units = n;
        take(row.value);
      }
    }
    if (out.gross_proceeds === null && /gross proceeds/.test(row.label)) {
      const n = firstMoney(row.value);
      if (n !== undefined) {
        out.gross_proceeds = n;
        take(row.value);
      }
    }
    if (out.exchange === null && /nasdaq|nyse|listed/.test(row.label)) {
      const ex = row.value.match(/\b(NASDAQ|NYSE|NYSE American)\b/i);
      if (ex) {
        out.exchange = ex[1]!.toUpperCase();
        take(row.value);
      }
    }
    if (isFounderLabel(row.label)) {
      if (out.founder_shares === null) {
        const n = founderShareCount(row.value);
        if (n !== undefined && n >= 1000) {
          out.founder_shares = n;
          take(row.value);
        }
      }
      if (out.founder_percent === null) {
        const p = firstPercentFraction(row.value);
        if (p !== undefined) {
          out.founder_percent = p;
          take(row.value);
        }
      }
    }
    if (out.private_placement_warrants === null && isPrivateWarrantLabel(row.label)) {
      const n = firstInteger(row.value);
      if (n !== undefined) {
        out.private_placement_warrants = n;
        take(row.value);
      }
    }
    if (out.private_placement_warrant_price === null && isPrivateWarrantLabel(row.label)) {
      const n = firstMoney(row.value);
      if (n !== undefined && n < PRICE_MIN) {
        out.private_placement_warrant_price = n;
        take(row.value);
      }
    }
  }
  return out;
}

function locates(text: string, value: number, label: string): boolean {
  return anchorFieldSpan(text, value, label) !== null;
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

function isTrustLabel(label: string): boolean {
  return /trust account|held in trust|proceeds to be held/.test(label);
}

function isCompositionLabel(label: string): boolean {
  return /securities offered|units offered|unit composition|each unit/.test(label);
}

function isFounderLabel(label: string): boolean {
  return /founder shares|class b/.test(label);
}

function isPrivateWarrantLabel(label: string): boolean {
  if (/units?$/.test(label) && !/warrants?/.test(label)) return false;
  return /private placement warrants?|sponsor warrants?/.test(label);
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

function perShareMoney(cell: string): number | undefined {
  const per = cell.match(
    /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*per\s+(?:public\s+)?(?:unit|share)/i
  );
  if (per) return parseNumeric(per[1]);
  const n = firstMoney(cell);
  if (n !== undefined && n >= PRICE_MIN && n <= PRICE_MAX) return n;
  return undefined;
}

function headlineTotal(cell: string): number | undefined {
  if (/per\s+(?:public\s+)?(?:unit|share)/i.test(cell)) return undefined;
  const n = firstMoney(cell);
  if (n !== undefined && n > PRICE_MAX) return n;
  return undefined;
}

function wordFraction(cell: string): number | undefined {
  for (const { re, value } of WORD_FRACTIONS) {
    if (re.test(cell)) return value;
  }
  return undefined;
}

function warrantFraction(cell: string): number | undefined {
  if (!/warrant/i.test(cell)) return undefined;
  return wordFraction(cell);
}

function rightFraction(cell: string): number | undefined {
  if (/\bone right\b/i.test(cell)) return 1;
  if (!/\brights?\b/i.test(cell)) return undefined;
  return wordFraction(cell);
}

function compositionClause(cell: string): string | null {
  const m = cell.match(/[^.,;]*consisting of[^.,;]*/i);
  return m ? m[0].trim() : null;
}

function founderShareCount(cell: string): number | undefined {
  const before = cell.split(/forfeiture/i)[0] ?? cell;
  return firstInteger(before);
}

function firstPercentFraction(cell: string): number | undefined {
  const m = cell.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return undefined;
  return n / 100;
}
