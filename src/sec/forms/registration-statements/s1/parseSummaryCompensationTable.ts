/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import {
  boundPrincipalPosition,
  isCompensationPositionLabel,
  normalizeFiscalYear,
} from "./sectionExtractors";
import type { ExecutiveCompensationRow } from "./executiveCompensationSchema";
import {
  cleanCell,
  isSeparatorRow,
  mergeHeaderRows,
  splitGfmTables,
  splitPipeRow,
} from "./gfmTables";

const MONEY_KINDS = [
  "salary",
  "bonus",
  "stock_awards",
  "option_awards",
  "non_equity_incentive",
  "pension_and_nqdc",
  "all_other_compensation",
  "total",
] as const;
type MoneyKind = (typeof MONEY_KINDS)[number];
type ColKind = "name" | "year" | MoneyKind;

export function parseSummaryCompensationTable(text: string): ExecutiveCompensationRow[] {
  try {
    return parseInner(text);
  } catch {
    return [];
  }
}

function parseInner(text: string): ExecutiveCompensationRow[] {
  const out: ExecutiveCompensationRow[] = [];
  let currentName: string | undefined;
  let currentPosition: string | null = null;
  for (const table of splitGfmTables(text)) {
    const header = findSctHeader(table);
    if (header === undefined) continue;
    const { kinds, startIdx } = header;
    currentName = undefined;
    currentPosition = null;
    for (const row of table.slice(startIdx + 1)) {
      const parsed = parseDataRow(row, kinds, text);
      if (parsed === undefined) continue;
      if (parsed.kind === "skip") continue;
      if (parsed.kind === "position") {
        if (currentName === undefined) continue;
        currentPosition = parsed.position;
        backfillPosition(out, currentName, currentPosition);
        if (!parsed.hasYearOrMoney) continue;
        out.push(makeRow(currentName, currentPosition, parsed, text));
        continue;
      }
      currentName = parsed.name;
      currentPosition = parsed.position;
      out.push(makeRow(currentName, currentPosition, parsed, text));
    }
  }
  if (out.length === 0) return [];
  if (!out.some((r) => text.includes(r.source_span) || text.includes(r.person_name))) return [];
  return out.filter((r) => text.includes(r.source_span) || text.includes(r.person_name));
}

function backfillPosition(
  out: ExecutiveCompensationRow[],
  person_name: string,
  position: string | null
): void {
  if (position === null) return;
  for (let i = out.length - 1; i >= 0; i--) {
    const row = out[i]!;
    if (row.person_name !== person_name) break;
    if (row.principal_position === null) row.principal_position = position;
  }
}

function makeRow(
  person_name: string,
  principal_position: string | null,
  parsed: ParsedData,
  text: string
): ExecutiveCompensationRow {
  const span = parsed.source_span;
  return {
    person_name,
    principal_position: boundPrincipalPosition(principal_position),
    fiscal_year: normalizeFiscalYear(parsed.fiscal_year),
    salary: parsed.salary,
    bonus: parsed.bonus,
    stock_awards: parsed.stock_awards,
    option_awards: parsed.option_awards,
    non_equity_incentive: parsed.non_equity_incentive,
    pension_and_nqdc: parsed.pension_and_nqdc,
    all_other_compensation: parsed.all_other_compensation,
    total: parsed.total,
    footnote: null,
    confidence: 1,
    source_span: text.includes(span) ? span : person_name,
    source: "deterministic",
  };
}

interface ParsedData {
  readonly kind: "person" | "position" | "skip";
  readonly name: string;
  readonly position: string | null;
  readonly fiscal_year: number | null;
  readonly salary: number | null;
  readonly bonus: number | null;
  readonly stock_awards: number | null;
  readonly option_awards: number | null;
  readonly non_equity_incentive: number | null;
  readonly pension_and_nqdc: number | null;
  readonly all_other_compensation: number | null;
  readonly total: number | null;
  readonly hasYearOrMoney: boolean;
  readonly source_span: string;
}

function parseDataRow(
  row: readonly string[],
  kinds: readonly (ColKind | null)[],
  _text: string
): ParsedData | undefined {
  const cells = row.map(cleanCell);
  const stubRaw = stubCell(cells, kinds);
  const stub = tidyName(stubRaw);
  if (stub === "" || /^totals?\b/i.test(stub) || isHeaderish(stub))
    return { ...emptyParsed(), kind: "skip" };
  const money: Record<MoneyKind, number | null> = {
    salary: null,
    bonus: null,
    stock_awards: null,
    option_awards: null,
    non_equity_incentive: null,
    pension_and_nqdc: null,
    all_other_compensation: null,
    total: null,
  };
  let fiscal_year: number | null = null;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    const cell = cells[i] ?? "";
    if (kind === "year") {
      const y = parseYear(cell);
      if (y !== null) fiscal_year = y;
      continue;
    }
    if (kind === null || kind === "name") continue;
    if (money[kind] !== null) continue;
    if (isBlankMoney(cell) || isFootnoteOnly(cell)) continue;
    const n = parseNumeric(cell.replace(/,/g, ""));
    if (n !== undefined && Number.isFinite(n)) money[kind] = n;
  }
  if (fiscal_year === null) {
    for (const cell of cells) {
      const y = parseYear(cell);
      if (y !== null) {
        fiscal_year = y;
        break;
      }
    }
  }
  if (money.salary === null) {
    for (let i = 0; i < cells.length; i++) {
      const kind = kinds[i] ?? null;
      if (kind !== null && kind !== "salary") continue;
      const cell = cells[i] ?? "";
      if (isBlankMoney(cell) || isFootnoteOnly(cell)) continue;
      if (parseYear(cell) !== null) continue;
      const n = parseNumeric(cell.replace(/,/g, ""));
      if (n !== undefined && Number.isFinite(n) && (n === 0 || Math.abs(n) >= 100)) {
        money.salary = n;
        break;
      }
    }
  }
  const hasYearOrMoney = fiscal_year !== null || MONEY_KINDS.some((k) => money[k] !== null);
  const { name, position: inlinePosition } = splitNameAndTitle(stub);
  const titleFromCell = cells.map((c) => tidyName(c)).find((c) => c !== stub && isPositionStub(c));
  const position = inlinePosition ?? boundPrincipalPosition(titleFromCell);
  const source_span = stubRaw === "" ? stub : stubRaw;
  if (isPositionStub(name) || isPositionStub(stub)) {
    return {
      kind: "position",
      name,
      position: boundPrincipalPosition(stub),
      fiscal_year,
      ...money,
      hasYearOrMoney,
      source_span,
    };
  }
  if (!looksLikePersonName(name)) return { ...emptyParsed(), kind: "skip" };
  return {
    kind: "person",
    name,
    position,
    fiscal_year,
    ...money,
    hasYearOrMoney,
    source_span,
  };
}

function emptyParsed(): ParsedData {
  return {
    kind: "skip",
    name: "",
    position: null,
    fiscal_year: null,
    salary: null,
    bonus: null,
    stock_awards: null,
    option_awards: null,
    non_equity_incentive: null,
    pension_and_nqdc: null,
    all_other_compensation: null,
    total: null,
    hasYearOrMoney: false,
    source_span: "",
  };
}

function stubCell(cells: readonly string[], kinds: readonly (ColKind | null)[]): string {
  const nameIdx = kinds.findIndex((k) => k === "name");
  if (nameIdx >= 0 && (cells[nameIdx] ?? "") !== "") return cells[nameIdx]!;
  return cells.find((c) => c !== "" && c !== "$" && c !== "%") ?? "";
}

function findSctHeader(
  table: readonly (readonly string[])[]
): { readonly kinds: Array<ColKind | null>; readonly startIdx: number } | undefined {
  for (let i = 0; i < table.length; i++) {
    if (isSctHeader(table[i]!)) {
      return { kinds: headerKinds(table[i]!), startIdx: i };
    }
    if (i + 1 >= table.length) continue;
    const merged = mergeHeaderRows(table[i]!, table[i + 1]!);
    if (isSctHeader(merged)) {
      return { kinds: headerKinds(merged), startIdx: i + 1 };
    }
  }
  return undefined;
}

function isSctHeader(row: readonly string[]): boolean {
  if (row.some((c) => /^term(?:s|\(s\))?$/i.test(cleanCell(c)))) return false;
  const kinds = headerKinds(row);
  if (!kinds.includes("name")) return false;
  const hasSalary = kinds.includes("salary");
  const hasYear = kinds.includes("year");
  if (hasYear && hasSalary) return true;
  return hasSalary && row.some((c) => /base\s*salary/i.test(cleanCell(c)));
}

function headerKinds(row: readonly string[]): Array<ColKind | null> {
  return row.map((cell) => columnKind(cleanCell(cell)));
}

function columnKind(cell: string): ColKind | null {
  const raw = cell.trim();
  if (raw === "$") return "salary";
  const t = raw
    .toLowerCase()
    .replace(/[$\(\)0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t === "") return null;
  if (/name and principal|principal position|^name\b/.test(t)) return "name";
  if (/^year$|^period$/.test(t)) return "year";
  if (/base salary|basesalary|^salary/.test(t)) return "salary";
  if (/^bonus/.test(t)) return "bonus";
  if (/stock award/.test(t)) return "stock_awards";
  if (/option award/.test(t)) return "option_awards";
  if (/non[\s-]?equity|nonequity/.test(t)) return "non_equity_incentive";
  if (/pension|nqdc|deferred compensation/.test(t)) return "pension_and_nqdc";
  if (/all other/.test(t)) return "all_other_compensation";
  if (/^total/.test(t)) return "total";
  return null;
}

function parseYear(cell: string): number | null {
  const m = cell.match(/\b(19|20)\d{2}\b/);
  if (m === null) return null;
  return normalizeFiscalYear(Number(m[0]));
}

function isBlankMoney(cell: string): boolean {
  return (
    cell === "" ||
    cell === "$" ||
    cell === "%" ||
    cell === "—" ||
    cell === "–" ||
    cell === "-" ||
    cell === "*"
  );
}

function tidyName(raw: string): string {
  return raw
    .replace(/\(\d+\)/g, "")
    .replace(/[\u200b\u200c\u200d\ufeff]/g, "")
    .replace(/,+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitNameAndTitle(stub: string): { name: string; position: string | null } {
  const parts = stub
    .split(/\s*[—–-]\s*|\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length >= 2 && isPositionStub(parts[parts.length - 1]!)) {
    return {
      name: tidyName(parts.slice(0, -1).join(" ")),
      position: boundPrincipalPosition(parts[parts.length - 1]),
    };
  }
  const peeled = peelInlineTitle(stub);
  if (peeled !== undefined) return peeled;
  return { name: stub, position: null };
}

const INLINE_TITLE =
  /\s+((?:President|CEO|CFO|COO|Chief|Officer|Secretary|Treasurer|Chairman|Director|General Manager|Legal Representative)\b.*)$/i;

function peelInlineTitle(stub: string): { name: string; position: string | null } | undefined {
  const m = stub.match(INLINE_TITLE);
  if (m === null || m.index === undefined) return undefined;
  const head = tidyName(stub.slice(0, m.index));
  if (!looksLikePersonName(head)) return undefined;
  return { name: head, position: boundPrincipalPosition(m[1]) };
}

function isPositionStub(name: string): boolean {
  if (isCompensationPositionLabel(name)) return true;
  if (
    /^(former|current|our)\s+(chief|president|vice|executive|director|officer|chairman)/i.test(name)
  ) {
    return true;
  }
  if (/^(pres|vp|cfo|ceo|coo|gc)\b/i.test(name)) return true;
  if (/^founder\b/i.test(name) || /\band$/i.test(name)) return true;
  return /^[A-Z]{2,4}(\/[A-Z]{2,4})+$/.test(name);
}

function looksLikePersonName(name: string): boolean {
  if (name.length < 3) return false;
  if (isPositionStub(name)) return false;
  const words = name
    .replace(/,.*$/, "")
    .split(/\s+/)
    .filter((w) => w !== "");
  return words.length >= 2;
}

function isHeaderish(stub: string): boolean {
  return /name and principal|principal position|^year$|^period$|^salary\b|^basesalary$|^title$/i.test(
    stub
  );
}

function isFootnoteOnly(cell: string): boolean {
  return /^\(\d+\)$/.test(cell.trim());
}
