/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** A dimension qualifier on a context (from segment/scenario members). */
export interface XbrlDimension {
  readonly dimension: string; // QName as written, e.g. "us-gaap:StatementClassOfStockAxis"
  readonly member: string; // explicit-member QName or typed-member text content
  readonly isTyped: boolean;
}

/** A resolved xbrli:context: reporting entity + period + dimensional qualifiers. */
export interface XbrlContext {
  readonly id: string;
  readonly entityIdentifier: string | null; // usually the 10-digit CIK
  readonly entityScheme: string | null;
  readonly periodStart: string | null;
  readonly periodEnd: string | null;
  readonly periodInstant: string | null;
  readonly isForever: boolean;
  readonly dimensions: readonly XbrlDimension[];
}

/** A resolved xbrli:unit, normalized to a display string (e.g. "USD", "shares", "USD/shares"). */
export interface XbrlUnit {
  readonly id: string;
  readonly measure: string;
}

/** Where a fact was parsed from. */
export type XbrlFactSource = "inline" | "instance";

/** A single XBRL fact, normalized across the inline and instance front-ends. */
export interface XbrlFact {
  readonly concept: string; // prefixed QName as written, e.g. "dei:EntityRegistrantName"
  readonly namespace: string | null; // resolved namespace URI for the concept prefix
  readonly contextRef: string | null;
  readonly unitRef: string | null;
  /** Raw text content (continuations followed, ix:exclude content dropped). */
  readonly rawText: string;
  /** Text value after the ixt format transform (sign/scale NOT applied). */
  readonly value: string;
  /** Numeric value with format transform, sign, and scale applied. Null for non-numeric/nil. */
  readonly numericValue: number | null;
  readonly decimals: string | null;
  readonly scale: number | null;
  readonly sign: "-" | null;
  readonly format: string | null;
  readonly isNil: boolean;
  readonly isNumeric: boolean;
  /** True when the fact came from the ix:hidden block (inline only). */
  readonly isHidden: boolean;
  /** Document-order index within the source document. */
  readonly order: number;
  readonly source: XbrlFactSource;
}

/** Parse result for one document (inline HTML or instance XML). */
export interface XbrlDocument {
  readonly facts: readonly XbrlFact[];
  readonly contexts: ReadonlyMap<string, XbrlContext>;
  readonly units: ReadonlyMap<string, XbrlUnit>;
  /** True when the document declares any XBRL content at all. */
  readonly hasXbrl: boolean;
}
