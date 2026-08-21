/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import { isCompanyFamilyPrefixEcho } from "../../../../storage/company/CompanyFamilyName";
import { isUnnamedCompanyName } from "../../../../storage/company/CompanyNormalization";
import type { UnderwriterRowOut } from "./underwriterSchema";

function nameKey(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim()
    .toLowerCase();
}

const PLACEHOLDER = /^(?:\[●\]|●|\[•\]|•|—|–|-|\*|\[·\]|\u25cf)?$/;
const TOTAL_ROW = /^totals?(?:\s+units?)?$/i;
const SKIP_NAME =
  /underwriting discounts|commissions paid|per unit|over-?allotment|number of units|selling (?:stockholder|securityholder|shareholder)|may be deemed|broker-?dealer|stabilizing transactions|ordinary brokerage/i;
const SELLING_HEADER = /selling (?:stockholder|securityholder|shareholder|securityholders?)/i;
const QIU = /qualified independent underwriter/i;
const SYNDICATE_HEADER = /\bunderwriters?\b/i;
const DISCOUNT_HEADER = /discount|commission|compensation by finra|conflicts of interest/i;
const LEGAL_END =
  /\b(?:inc(?:orporated)?|llc|l\.l\.c|ltd|limited|llp|l\.l\.p|l\.p|lp|plc|corp(?:oration)?|company|co|ag|s\.a\.?|gmbh|n\.v\.?)\b/i;
const FIRM_HINT =
  /\b(?:securities|capital markets|capital|partners|markets|bancorp|bank|advisory)\b/i;
const AND_CO = /&\s*co\.?/i;

export function parseSpacUnderwriters(text: string): UnderwriterRowOut[] {
  try {
    return parseSpacUnderwritersInner(text);
  } catch {
    return [];
  }
}

function parseSpacUnderwritersInner(text: string): UnderwriterRowOut[] {
  const tables = splitGfmTables(text);
  const syndicate: Candidate[] = [];
  const qiu: Candidate[] = [];
  for (const table of tables) {
    const blob = table.flat().join(" ");
    if (SELLING_HEADER.test(blob)) continue;
    const headed = extractNamedRows(table, { requireSyndicateHeader: true });
    syndicate.push(...headed);
    if (headed.length === 0 && isHeaderlessAllocation(table)) {
      syndicate.push(...extractNamedRows(table, { requireSyndicateHeader: false }));
    }
    if (QIU.test(blob)) {
      qiu.push(...extractNamedRows(table, { requireSyndicateHeader: false }));
    }
  }
  const keepQiu = syndicate.length > 0 ? qiu : [];
  const merged = dedupe([...syndicate, ...keepQiu]);
  const located = merged.filter((c) => text.includes(c.legal_name));
  return located.map((c) => ({
    legal_name: c.legal_name,
    role: null,
    shares_allocated: c.shares_allocated,
    over_allotment_shares: null,
    confidence: 1,
    source_span: c.source_span,
    source: "deterministic" as const,
  }));
}

interface Candidate {
  readonly legal_name: string;
  readonly shares_allocated: number | null;
  readonly source_span: string;
}

function extractNamedRows(
  table: readonly (readonly string[])[],
  opts: { readonly requireSyndicateHeader: boolean }
): Candidate[] {
  let headerIdx = -1;
  let nameCol = 0;
  for (let i = 0; i < table.length; i++) {
    const row = table[i]!;
    const col = row.findIndex((cell) => isSyndicateHeaderCell(cell));
    if (col >= 0) {
      headerIdx = i;
      nameCol = col;
      break;
    }
  }
  if (opts.requireSyndicateHeader && headerIdx < 0) return [];
  const start = headerIdx >= 0 ? headerIdx + 1 : 0;
  const out: Candidate[] = [];
  for (let i = start; i < table.length; i++) {
    const row = table[i]!;
    const raw = cleanCell(row[nameCol] ?? row[0] ?? "");
    if (raw === "" || PLACEHOLDER.test(raw)) continue;
    if (QIU.test(raw)) {
      if (opts.requireSyndicateHeader) break;
      continue;
    }
    if (TOTAL_ROW.test(raw) || SKIP_NAME.test(raw) || DISCOUNT_HEADER.test(raw)) continue;
    if (isSyndicateHeaderCell(raw)) continue;
    const unitsCell = cleanCell(row[nameCol + 1] ?? "");
    const shares = integerCount(unitsCell);
    for (const legal_name of splitFirmNames(raw)) {
      if (!isKeepName(legal_name)) continue;
      if (!opts.requireSyndicateHeader && !looksLikeFirmName(legal_name)) continue;
      out.push({
        legal_name,
        shares_allocated: shares,
        source_span: raw,
      });
    }
  }
  return out;
}

function isKeepName(name: string): boolean {
  if (name.length < 3 || name.length > 140) return false;
  if (PLACEHOLDER.test(name) || TOTAL_ROW.test(name) || SKIP_NAME.test(name)) return false;
  if (isUnnamedCompanyName(name)) return false;
  if (!/\p{L}/u.test(name)) return false;
  if (/[;]$/.test(name)) return false;
  const words = name.split(/\s+/).length;
  if (words > 24) return false;
  if (looksLikeFirmName(name)) return true;
  if (/,$/.test(name)) return false;
  if (/^(?:our|the|a|an|this|these|its|any|each)\b/i.test(name)) return false;
  if (!/[A-Z]/.test(name)) return false;
  return words <= 6;
}

function isHeaderlessAllocation(table: readonly (readonly string[])[]): boolean {
  if (table.some((row) => row.some((cell) => isSyndicateHeaderCell(cell)))) return false;
  const blob = table.flat().join(" ");
  if (/per unit|discounts and commissions|paid by|payable by/i.test(blob)) return false;
  const hasTotal = table.some((row) => TOTAL_ROW.test(cleanCell(row[0] ?? "")));
  if (!hasTotal) return false;
  return table.some((row) => looksLikeFirmName(tidyName(row[0] ?? "")));
}

/**
 * True when a syndicate allocation table contains at least one firm-like name.
 * Declines on a throw, like {@link parseSpacUnderwriters}: it is called from the
 * eval bucketer, where a throw would abort the whole run.
 */
export function hasSpacSyndicateTable(text: string): boolean {
  try {
    return findSyndicateTable(text);
  } catch {
    return false;
  }
}

function findSyndicateTable(text: string): boolean {
  for (const table of splitGfmTables(text)) {
    const blob = table.flat().join(" ");
    if (SELLING_HEADER.test(blob)) continue;
    if (table.some((row) => row.some((cell) => isSyndicateHeaderCell(cell)))) {
      for (const row of table) {
        const n = tidyName(row[0] ?? "");
        if (n === "" || TOTAL_ROW.test(n) || isSyndicateHeaderCell(n) || QIU.test(n)) continue;
        if (looksLikeFirmName(n) || isKeepName(n)) return true;
      }
      continue;
    }
    if (isHeaderlessAllocation(table)) return true;
  }
  return false;
}

function looksLikeFirmName(name: string): boolean {
  return LEGAL_END.test(name) || AND_CO.test(name) || FIRM_HINT.test(name);
}

function splitFirmNames(raw: string): string[] {
  const trimmed = tidyName(raw);
  const parts = trimmed
    .split(/\s+and\s+|,\s+and\s+/i)
    .map((p) => tidyName(p))
    .filter((p) => p !== "");
  if (parts.length >= 2 && parts.every((p) => looksLikeFirmName(p))) return parts;
  return [trimmed];
}

function tidyName(name: string): string {
  return name
    .replace(/\(\d+\)\s*$/, "")
    .replace(/[\u00b9\u00b2\u00b3\u2020\u2021*]+$/u, "")
    .replace(/(?<=\bLLC)\.+$/i, "")
    .trim();
}

function isSyndicateHeaderCell(cell: string): boolean {
  const t = cleanCell(cell);
  if (t === "") return false;
  if (SELLING_HEADER.test(t) || DISCOUNT_HEADER.test(t) || QIU.test(t)) return false;
  if (/deemed/.test(t)) return false;
  return SYNDICATE_HEADER.test(t);
}

function integerCount(raw: string): number | null {
  if (raw === "" || PLACEHOLDER.test(raw)) return null;
  const n = parseNumeric(raw.replace(/,/g, ""));
  if (n === undefined || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function dedupe(rows: readonly Candidate[]): Candidate[] {
  const names = rows.map((r) => r.legal_name);
  const kept: Candidate[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (isCompanyFamilyPrefixEcho(row.legal_name, names)) continue;
    const key = nameKey(row.legal_name);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  return kept;
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
