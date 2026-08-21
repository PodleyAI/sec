/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reading GFM pipe tables back out of a rendered section.
 *
 * {@link ../../../html/TableExtractor} turns a filing's `<table>` into a
 * `TableNode`, which the renderer prints as pipe rows; every deterministic
 * section walk then has to parse those rows back. Seven of them each carried a
 * private copy of these six functions, and the copies had diverged on escaped
 * pipes — so the same rendered table split into a different number of columns
 * depending on which walk read it, silently shifting every field to the right
 * of the escape.
 *
 * What belongs here is the table grammar, and nothing above it. A parser's own
 * name tidying, stub tests and column vocabulary stay in the parser: those read
 * differently per section on purpose (an ownership row strips a `(our sponsor)`
 * parenthetical that an underwriter row must keep), and pulling them up here
 * would be the same over-merge in the other direction.
 */

/**
 * Split one rendered row into its cells, honouring the `\|` escape the renderer
 * writes for a pipe INSIDE a cell.
 *
 * That escape is why this is a scan rather than `split("|")`. A filer who
 * prints `Class A | Class B` in a single cell renders as one escaped pipe, and
 * splitting on it naively yields an extra column — so every value after it
 * lands one position right, into a neighbouring field, with nothing failing.
 *
 * Cells are returned **untrimmed**; callers that care run them through
 * {@link cleanCell}, which also folds the zero-width and non-breaking spaces
 * EDGAR markup is full of.
 */
export function splitPipeRow(line: string): string[] {
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

/** The `|---|:--:|` rule under a header, which carries no data. */
export function isSeparatorRow(line: string): boolean {
  return /^\|[\s:|-]+\|$/.test(line) || /^[\s|:-]+$/.test(line);
}

/**
 * Normalize one cell's whitespace. The zero-width characters and the
 * non-breaking space are folded to a plain space rather than deleted: EDGAR
 * filer agents use them as spacing, so removing them joins two words.
 */
export function cleanCell(raw: string): string {
  return raw
    .replace(/[\u200b\u200c\u200d\ufeff\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every pipe table in a rendered section, as rows of cleaned cells. A run of
 * consecutive pipe lines is one table; any other line ends it.
 */
export function splitGfmTables(text: string): string[][][] {
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

/**
 * Drop a row's empty cells and its immediate repeats. Filer markup pads a grid
 * with spacer columns carrying the `$` sign and footnote markers, and a
 * colspan-stretched caption expands to the same text in every column it spans;
 * neither is a value.
 */
export function collapseRow(row: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of row) {
    const cell = cleanCell(raw);
    if (cell === "") continue;
    if (out[out.length - 1] === cell) continue;
    out.push(cell);
  }
  return out;
}

/**
 * Fold a two-line header into one caption per column. A blank upper cell takes
 * the lower one; a stretched upper caption (repeating the stub column's text)
 * yields to the lower; otherwise the two are joined.
 */
export function mergeHeaderRows(a: readonly string[], b: readonly string[]): string[] {
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
