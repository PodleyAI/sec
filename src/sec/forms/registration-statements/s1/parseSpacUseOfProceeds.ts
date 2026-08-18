/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseNumeric } from "../../../html/parseNumeric";
import type { UseOfProceedsLineRow } from "./useOfProceedsSchema";

const MIN_LINES = 2;
const MIN_AMOUNT = 1_000;
const SKIP_PURPOSE =
  /gross proceeds|^totals?\b|proceeds after|reimbursed expenses|% public offering|offering expenses\b(?! \()/i;

export function parseSpacUseOfProceeds(text: string): UseOfProceedsLineRow[] {
  try {
    return parseInner(text);
  } catch {
    return [];
  }
}

function parseInner(text: string): UseOfProceedsLineRow[] {
  const out: UseOfProceedsLineRow[] = [];
  for (const table of splitGfmTables(text)) {
    for (const row of table) {
      const cells = row.map(cleanCell).filter((c, i, arr) => !(c === "" && i > 0 && arr[0] === ""));
      const purposeRaw = cells.find((c) => c !== "" && c !== "$" && c !== "%") ?? "";
      const purpose = tidyPurpose(purposeRaw);
      if (purpose === "" || SKIP_PURPOSE.test(purpose) || isHeaderRow(cells)) continue;
      const amount = firstAmount(cells);
      if (amount === null) continue;
      if (!text.includes(purposeRaw) && !text.includes(purpose)) continue;
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
  }
  if (out.length < MIN_LINES) return [];
  return out;
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
