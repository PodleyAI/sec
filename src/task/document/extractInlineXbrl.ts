/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { parseInlineXbrl } from "../../sec/xbrl/parseInlineXbrl";
import { toXbrlFactRows } from "../../sec/xbrl/toFactRows";
import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";

/**
 * Facts embedded in a filing's own HTML, as filed.
 *
 * The complement of `company_facts`, which is the companyfacts API's normalized
 * history: these are the values the filer tagged in the document a reader is
 * looking at, so a number here can be pointed back at the markup that carried
 * it, and a restatement shows up as two different documents rather than one
 * revised series.
 *
 * Returns no rows for a document carrying no inline markup, which is most of
 * them — `parseInlineXbrl` checks the namespace before it loads the DOM, so the
 * cost on a non-XBRL exhibit is a regex over the head of the file.
 *
 * `fact_index` is the fact's position within THIS document, so the rows of a
 * submission whose primary document and exhibits both carry markup collide on
 * the primary key. Callers pass `indexOffset` to continue the numbering across
 * a submission's documents.
 */
export function extractInlineXbrlRows(args: {
  readonly html: string;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly indexOffset?: number;
  readonly created_at?: string;
}): XbrlFactRow[] {
  const doc = parseInlineXbrl(args.html);
  if (!doc.hasXbrl || doc.facts.length === 0) return [];
  const rows = toXbrlFactRows({
    doc,
    accession_number: args.accession_number,
    cik: args.cik,
    ...(args.created_at === undefined ? {} : { created_at: args.created_at }),
  });
  const offset = args.indexOffset ?? 0;
  if (offset === 0) return rows;
  return rows.map((row) => ({ ...row, fact_index: row.fact_index + offset }));
}
