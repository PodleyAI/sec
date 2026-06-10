/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { XbrlFactRow } from "../../storage/xbrl/XbrlFactSchema";
import type { XbrlDocument } from "./types";

/**
 * Flattens a parsed XBRL document into storage rows, denormalizing each
 * fact's context period/dimensions and resolved unit onto the row.
 */
export function toXbrlFactRows(args: {
  readonly doc: XbrlDocument;
  readonly accession_number: string;
  readonly cik: number | null;
  readonly created_at?: string;
}): XbrlFactRow[] {
  const { doc, accession_number, cik } = args;
  const created_at = args.created_at ?? new Date().toISOString();
  return doc.facts.map((fact, fact_index) => {
    const context = fact.contextRef !== null ? doc.contexts.get(fact.contextRef) : undefined;
    const unit = fact.unitRef !== null ? (doc.units.get(fact.unitRef)?.measure ?? null) : null;
    return {
      accession_number,
      fact_index,
      cik,
      concept: fact.concept,
      namespace: fact.namespace,
      context_ref: fact.contextRef,
      unit,
      period_start: context?.periodStart ?? null,
      period_end: context?.periodEnd ?? null,
      period_instant: context?.periodInstant ?? null,
      value_text: fact.isNil ? null : fact.value,
      value_numeric: fact.numericValue,
      decimals: fact.decimals,
      sign: fact.sign,
      format: fact.format,
      is_numeric: fact.isNumeric,
      is_hidden: fact.isHidden,
      dimensions_json:
        context !== undefined && context.dimensions.length > 0
          ? JSON.stringify(context.dimensions)
          : null,
      source: fact.source,
      created_at,
    };
  });
}
