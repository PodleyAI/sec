/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import { hasCompanyEnding } from "../../../../storage/company/CompanyNormalization";
import { normalizeManagementTitles } from "./normalizeTitle";
import { isCollectivePartyName, isCompensationPositionLabel } from "./sectionExtractors";
import type { ManagementPersonRow } from "./sectionSchemas";
import {
  cleanCell,
  collapseRow,
  isSeparatorRow,
  mergeHeaderRows,
  splitGfmTables,
  splitPipeRow,
} from "./gfmTables";

export function parseManagementRoster(text: string): ManagementPersonRow[] {
  try {
    return parseInner(text);
  } catch {
    return [];
  }
}

export function hasManagementRosterTable(text: string | undefined): boolean {
  if (text === undefined || text.trim() === "") return false;
  return splitGfmTables(text).some((table) => findRosterHeader(table) !== undefined);
}

type ColKind = "name" | "age" | "title" | "other";

function parseInner(text: string): ManagementPersonRow[] {
  const out: ManagementPersonRow[] = [];
  for (const table of splitGfmTables(text)) {
    const header = findRosterHeader(table);
    if (header === undefined) continue;
    for (const row of table.slice(header.startIdx + 1)) {
      const parsed = parseDataRow(row, text);
      if (parsed === undefined) continue;
      out.push(parsed);
    }
  }
  const located = out.filter(
    (r) => r.titles.length > 0 && (text.includes(r.source_span) || text.includes(r.full_name))
  );
  return located;
}

function findRosterHeader(table: readonly (readonly string[])[]):
  | {
      readonly startIdx: number;
      readonly kinds: readonly ColKind[];
      readonly combinedName: boolean;
    }
  | undefined {
  for (let i = 0; i < table.length; i++) {
    const one = classifyHeader(table[i]!);
    if (one !== undefined) return { startIdx: i, ...one };
    if (i + 1 < table.length) {
      const merged = classifyHeader(mergeHeaderRows(table[i]!, table[i + 1]!));
      if (merged !== undefined) return { startIdx: i + 1, ...merged };
    }
  }
  return undefined;
}

function classifyHeader(
  row: readonly string[]
): { readonly kinds: readonly ColKind[]; readonly combinedName: boolean } | undefined {
  const cells = collapseRow(row);
  if (cells.length === 0) return undefined;
  const kinds: ColKind[] = cells.map(cellKind);
  const hasName = kinds.includes("name");
  const hasAge = kinds.includes("age");
  const hasTitle = kinds.includes("title");
  if (!hasName || (!hasAge && !hasTitle && !cells.some(isCombinedNameCell))) return undefined;
  const blob = cells.join(" ").toLowerCase();
  if (/beneficial owner|shares beneficially|percent of class/.test(blob)) return undefined;
  const combinedName = cells.some(isCombinedNameCell);
  if (!hasAge && !hasTitle && !combinedName) return undefined;
  return { kinds, combinedName };
}

function cellKind(cell: string): ColKind {
  const t = cell.toLowerCase();
  if (/\bname\b/.test(t)) return "name";
  if (/\bage\b/.test(t)) return "age";
  if (/\b(titles?|positions?)\b/.test(t) && !/occupation/.test(t)) return "title";
  return "other";
}

function isCombinedNameCell(cell: string): boolean {
  const t = cell.toLowerCase();
  return /\bname\b/.test(t) && /\b(title|position)/.test(t);
}

function parseDataRow(row: readonly string[], text: string): ManagementPersonRow | undefined {
  const cells = collapseRow(row);
  if (cells.length === 0) return undefined;
  const rawName = cells[0] ?? "";
  const peeled = splitNameAndTitles(tidyName(rawName));
  const full_name = peeled.name;
  if (full_name === "" || isSkipName(full_name)) return undefined;
  if (!looksLikePerson(full_name)) return undefined;
  let age: number | null = null;
  const titleBits: string[] = [];
  for (const cell of cells.slice(1)) {
    const parsedAge = parseAge(cell);
    if (parsedAge !== null) {
      if (age === null) age = parsedAge;
      continue;
    }
    const t = tidyName(cell);
    if (t !== "") titleBits.push(t);
  }
  const fromRest = normalizeManagementTitles(titleBits.join(", "));
  const titles = peeled.titles.length > 0 ? peeled.titles : fromRest;
  if (titles.length === 0) return undefined;
  const source_span = text.includes(rawName) ? rawName : full_name;
  return {
    full_name,
    titles,
    relationship: null,
    age,
    bio: null,
    confidence: 1,
    source_span,
    source: "deterministic",
  };
}

const TITLE_START =
  /\s+(?=(?:Independent\s+|Non-Executive\s+|Executive\s+|Senior\s+|Vice\s+|Interim\s+|Acting\s+)*(?:Chief|Chairman|Chairwoman|Chairperson|Chair\b|President|Director|CEO\b|CFO\b|COO\b|CTO\b|CIO\b|General Counsel|Secretary|Treasurer|Founder|Nominee|Managing))/i;

function splitNameAndTitles(cell: string): { readonly name: string; readonly titles: string[] } {
  const m = cell.match(TITLE_START);
  if (m === null || m.index === undefined || m.index < 3) {
    return { name: cell, titles: [] };
  }
  const name = cell.slice(0, m.index).replace(/,+$/g, "").trim();
  const rest = cell.slice(m.index).trim();
  if (name.split(/\s+/).filter((w) => w !== "").length < 2) {
    return { name: cell, titles: [] };
  }
  return { name, titles: normalizeManagementTitles(rest) };
}

function parseAge(raw: string): number | null {
  const cleaned = raw.replace(/\(\d+\)/g, "").trim();
  if (cleaned === "" || cleaned === "—" || cleaned === "–" || cleaned === "-") return null;
  const n = parseNumeric(cleaned.replace(/,/g, ""));
  if (n === undefined || !Number.isInteger(n)) return null;
  if (n < 18 || n > 100) return null;
  return n;
}

function isSkipName(name: string): boolean {
  if (/^\[?[·•●▪▫]\s*\]?$/.test(name)) return true;
  if (/^[·•●▪▫]/.test(name)) return true;
  if (/:\s*$/.test(name)) return true;
  if (isCollectivePartyName(name)) return true;
  if (isCompensationPositionLabel(name)) return true;
  if (/^all\b/i.test(name) && /\b(directors?|officers?|nominees?)\b/i.test(name)) return true;
  return /table of contents|directors and executive|executive officers|named executive|principal occupation/i.test(
    name
  );
}

function looksLikePerson(name: string): boolean {
  if (name.length < 3) return false;
  if (hasCompanyEnding(name) || hasCompanyEnding(name.replace(/\.+$/, ""))) return false;
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
