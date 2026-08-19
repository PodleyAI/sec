/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { hasCompanyEnding } from "../../../../storage/company/CompanyNormalization";
import { legalFormTrailingCanonical } from "../../../../util/legalForms";
import { isCollectivePartyName } from "./sectionExtractors";
import type { RelatedPartyRow } from "./sectionSchemas";

export function parseRelatedPartyTables(text: string): RelatedPartyRow[] {
  try {
    return parseInner(text);
  } catch {
    return [];
  }
}

export function hasRelatedPartyTable(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  return splitGfmTables(text).some((table) => findPartyHeader(table) !== undefined);
}

function parseInner(text: string): RelatedPartyRow[] {
  const out: RelatedPartyRow[] = [];
  const seen = new Set<string>();
  for (const table of splitGfmTables(text)) {
    const startIdx = findPartyHeader(table);
    if (startIdx === undefined) continue;
    for (const row of table.slice(startIdx + 1)) {
      const parsed = parseDataRow(row, text);
      if (parsed === undefined) continue;
      const key = parsed.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(parsed);
    }
  }
  return out.filter((r) => text.includes(r.source_span) || text.includes(r.name));
}

function findPartyHeader(table: readonly (readonly string[])[]): number | undefined {
  for (let i = 0; i < table.length; i++) {
    if (isPartyHeader(table[i]!)) return i;
    if (i + 1 < table.length && isPartyHeader(mergeHeaderRows(table[i]!, table[i + 1]!))) {
      return i + 1;
    }
  }
  return undefined;
}

function isPartyHeader(row: readonly string[]): boolean {
  const cells = collapseRow(row);
  if (cells.length < 2) return false;
  if (cells.some((c) => isBulletCell(c) || c.length > 80)) return false;
  const blob = cells.join(" ").toLowerCase();
  if (/table of contents|fiscal year ended|sales to joint/.test(blob)) return false;
  const hasParty = cells.some((c) =>
    /^(related (person|party)s?|participants?|purchasers?|stockholders?|shareholders?|name\b|party name|convertible note)/i.test(
      c.trim()
    )
  );
  const hasFigure = cells.some((c) =>
    /amount|principal|\bshares\b|consideration|purchase price|^transactions?\b/i.test(c)
  );
  return hasParty && hasFigure;
}

function isBulletCell(cell: string): boolean {
  return /^[Ø·•●▪▫]/.test(cell);
}

function parseDataRow(row: readonly string[], text: string): RelatedPartyRow | undefined {
  const cells = collapseRow(row);
  if (cells.length === 0) return undefined;
  const rawName = cells[0] ?? "";
  const name = tidyName(rawName);
  if (name === "" || isSkipName(name)) return undefined;
  if (!looksLikeParty(name)) return undefined;
  const source_span = text.includes(rawName) ? rawName : name;
  return {
    name,
    party_kind: partyKind(name),
    confidence: 1,
    source_span,
    transactions: [],
    source: "deterministic",
  };
}

function looksLikeCompanyName(name: string): boolean {
  return hasCompanyEnding(name) || legalFormTrailingCanonical.some(([re]) => re.test(name));
}

function partyKind(name: string): "person" | "company" {
  return looksLikeCompanyName(name) ? "company" : "person";
}

function isSkipName(name: string): boolean {
  if (/^\[?[·•●▪▫Ø]\s*\]?$/.test(name) || /^[·•●▪▫Ø]/.test(name)) return true;
  if (/^\d+$/.test(name)) return true;
  if (isCollectivePartyName(name)) return true;
  return /table of contents|participants?\(\d+\)|^stockholders?$|^shareholders?$|^name\b|fiscal year|short term|convertible note|original principal|liability related/i.test(
    name
  );
}

function looksLikeParty(name: string): boolean {
  if (name.length < 3) return false;
  if (looksLikeCompanyName(name)) return true;
  const words = name.split(/\s+/).filter((w) => w !== "");
  return words.length >= 2;
}

function tidyName(raw: string): string {
  return raw
    .replace(/\(\d+\)/g, "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/,+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
