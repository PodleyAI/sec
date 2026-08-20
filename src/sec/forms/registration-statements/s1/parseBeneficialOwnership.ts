/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import { hasCompanyEnding } from "../../../../storage/company/CompanyNormalization";
import { isOwnershipGroupSubtotal } from "./sectionExtractors";
import type { BeneficialOwnerRow } from "./sectionSchemas";

export function parseBeneficialOwnership(text: string): BeneficialOwnerRow[] {
  try {
    return parseInner(text);
  } catch {
    return [];
  }
}

export function hasBeneficialOwnershipTable(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  return splitGfmTables(text).some((table) => findOwnershipHeader(table) !== undefined);
}

const CLASS_HEADER = /\bclass\b|\bseries\b|title of (?:class|security)/i;
const OFFERED_HEADER = /\boffered\b|being offered|to be sold/i;
const AFTER_HEADER = /\bafter\b|\bfollowing\b/i;
const SELLING_TABLE = /selling (?:stockholder|shareholder|securityholder)/i;
const FOOTNOTE_MARKER = /\(\d+\)/;

/**
 * The ownership columns this parse fills for THIS table, as
 * `beneficial_ownership.<column>` destinations.
 *
 * Six of the nine columns are hardcoded null by {@link parseBeneficialOwnership}
 * — but a null is only a loss when the table had something to say. A SPAC's
 * pre-IPO ownership table prints one class, no "Shares Offered" and no "after
 * the offering" columns, carries no selling stockholders and no footnote
 * markers: there `null` IS the disclosure, and the parse is complete. A resale
 * registration's table prints all of them, and there the same nulls delete
 * figures the filing states. The question can only be answered by reading the
 * table, so coverage is read off the same headers and rows the parse walks.
 */
export function ownershipCoverage(text: string): ReadonlySet<string> {
  const out = new Set<string>([
    "beneficial_ownership.owner_kind",
    "beneficial_ownership.shares_owned",
    "beneficial_ownership.percent_owned",
    "person_observation",
    "company_observation",
    "observation_provenance",
  ]);
  let headers = "";
  let footnoted = false;
  for (const table of splitGfmTables(text)) {
    const header = findOwnershipHeader(table);
    if (header === undefined) continue;
    headers += ` ${table
      .slice(0, header.startIdx + 1)
      .flat()
      .join(" ")}`;
    for (const row of table.slice(header.startIdx + 1)) {
      if (row.some((cell) => FOOTNOTE_MARKER.test(cell))) footnoted = true;
    }
  }
  if (!CLASS_HEADER.test(headers)) out.add("beneficial_ownership.security_class");
  if (!OFFERED_HEADER.test(headers)) out.add("beneficial_ownership.shares_offered");
  if (!AFTER_HEADER.test(headers)) {
    out.add("beneficial_ownership.shares_after");
    out.add("beneficial_ownership.percent_after");
  }
  // `is_selling_stockholder: false` is a positive claim, not an absent one, so
  // it may only be asserted for a section that registers no resale at all.
  if (!SELLING_TABLE.test(text)) out.add("beneficial_ownership.is_selling_stockholder");
  if (!footnoted) out.add("beneficial_ownership.footnote");
  return out;
}

function parseInner(text: string): BeneficialOwnerRow[] {
  const out: BeneficialOwnerRow[] = [];
  for (const table of splitGfmTables(text)) {
    const header = findOwnershipHeader(table);
    if (header === undefined) continue;
    const { startIdx } = header;
    for (const row of table.slice(startIdx + 1)) {
      const parsed = parseDataRow(row, text);
      if (parsed === undefined) continue;
      out.push(parsed);
    }
  }
  return out.filter((r) => text.includes(r.source_span) || text.includes(r.name));
}

function findOwnershipHeader(
  table: readonly (readonly string[])[]
): { readonly startIdx: number } | undefined {
  for (let i = 0; i < table.length; i++) {
    if (isOwnershipHeader(table[i]!)) return { startIdx: i };
    if (i + 1 < table.length && isOwnershipHeader(mergeHeaderRows(table[i]!, table[i + 1]!))) {
      return { startIdx: i + 1 };
    }
    if (isNameCaptionRow(table[i]!)) {
      return { startIdx: i };
    }
  }
  return undefined;
}

function isNameCaptionRow(row: readonly string[]): boolean {
  const stub = collapseRow(row).join(" ");
  if (/\d{3,}/.test(stub)) return false;
  return /name and address of beneficial owner|^name of beneficial owner/i.test(stub);
}

function isOwnershipHeader(row: readonly string[]): boolean {
  const cells = collapseRow(row);
  const blob = cells.join(" ").toLowerCase();
  const hasName = /beneficial owner|^name\b/.test(blob);
  const hasShares =
    /number of shares|shares beneficially|amount and nature|beneficially owned/.test(blob);
  const hasPercent = /percent/.test(blob);
  return hasName && (hasShares || hasPercent);
}

function parseDataRow(row: readonly string[], text: string): BeneficialOwnerRow | undefined {
  const cells = collapseRow(row);
  const stubRaw = cells.find((c) => c !== "" && c !== "$" && c !== "%" && c !== "*") ?? "";
  const stub = peelName(tidyName(stubRaw));
  if (stub === "" || isSkipStub(stub)) return undefined;
  if (isGroupRow(stub)) return undefined;
  if (!looksLikeOwner(stub)) return undefined;
  const { shares_owned, percent_owned } = parseFigures(cells);
  const source_span = text.includes(stubRaw) ? stubRaw : stub;
  return {
    name: stub,
    owner_kind: ownerKind(stub),
    security_class: null,
    shares_owned,
    percent_owned,
    shares_offered: null,
    shares_after: null,
    percent_after: null,
    is_selling_stockholder: false,
    footnote: null,
    confidence: 1,
    source_span,
    source: "deterministic",
  };
}

function parseFigures(cells: readonly string[]): {
  readonly shares_owned: number | null;
  readonly percent_owned: number | null;
} {
  let shares_owned: number | null = null;
  let percent_owned: number | null = null;
  let pending: number | null = null;
  for (const cell of cells) {
    if (isFootnoteOnly(cell) || isBlankMoney(cell)) continue;
    if (cell === "*") {
      percent_owned = null;
      pending = null;
      continue;
    }
    if (cell === "%") {
      if (pending !== null && pending <= 100) percent_owned = pending;
      pending = null;
      continue;
    }
    const n = parseNumeric(cell.replace(/,/g, ""));
    if (n === undefined || !Number.isFinite(n)) continue;
    if (shares_owned === null && Number.isInteger(n) && (n === 0 || Math.abs(n) >= 1)) {
      shares_owned = n;
      continue;
    }
    pending = n;
  }
  if (percent_owned === null && pending !== null && pending <= 100 && shares_owned !== null) {
    percent_owned = pending;
  }
  return { shares_owned, percent_owned };
}

function isGroupRow(name: string): boolean {
  if (isOwnershipGroupSubtotal(name)) return true;
  return /^all\b/i.test(name) && /\b(directors?|officers?|nominees?)\b/i.test(name);
}

function ownerKind(name: string): "person" | "company" {
  const stripped = name.replace(/\.+$/, "");
  return hasCompanyEnding(name) || hasCompanyEnding(stripped) ? "company" : "person";
}

function isSkipStub(stub: string): boolean {
  if (/:\s*$/.test(stub)) return true;
  return /principal shareholders|directors and executive|beneficial owner|^name\b|prior to offering|approximate percentage|amount and nature|table of contents|less than|5%\s*or more|named executive|shares beneficially|beneficially owned/i.test(
    stub
  );
}

function looksLikeOwner(name: string): boolean {
  if (name.length < 3) return false;
  if (isSkipStub(name) || isGroupRow(name)) return false;
  if (hasCompanyEnding(name)) return true;
  const words = name.split(/\s+/).filter((w) => w !== "");
  return words.length >= 2;
}

function peelName(stub: string): string {
  let s = stub.replace(/\s+c\/o\s+.*/i, "").trim();
  s = s
    .replace(/,\s+(?:Chief|Director|President|Legal Representative|Officer|CEO|CFO|COO)\b.*/i, "")
    .trim();
  s = s.replace(/\s+\d{2,}\s+\S+.*/, "").trim();
  return s;
}

function tidyName(raw: string): string {
  return raw
    .replace(/\(\d+\)/g, "")
    .replace(/\((?:our\s+)?sponsor\)/gi, "")
    .replace(/\((?:ceo|cfo|coo|president|director|officer)\)/gi, "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/,+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isFootnoteOnly(cell: string): boolean {
  return /^\(\d+\)$/.test(cell.trim());
}

function isBlankMoney(cell: string): boolean {
  return cell === "" || cell === "$" || cell === "—" || cell === "–" || cell === "-";
}

function collapseRow(row: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of row) {
    const cell = cleanCell(raw);
    if (cell === "") continue;
    if (out[out.length - 1] === cell) continue;
    out.push(cell);
  }
  return out;
}

function mergeHeaderRows(a: readonly string[], b: readonly string[]): string[] {
  const n = Math.max(a.length, b.length);
  const a0 = cleanCell(a[0] ?? "");
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const left = cleanCell(a[i] ?? "");
    const right = cleanCell(b[i] ?? "");
    if (left === "" || (i > 0 && left === a0)) {
      out.push(right);
      continue;
    }
    if (right === "" || right === left) {
      out.push(left);
      continue;
    }
    out.push(`${left} ${right}`);
  }
  return out;
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
  const inner = line.startsWith("|") ? line.slice(1) : line;
  const end = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return end.split("|");
}
