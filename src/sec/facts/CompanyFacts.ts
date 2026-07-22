/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json

import { Static, Type } from "typebox";
import { Frame } from "../../util/BaseTypes";
import { TypeDate, TypeNullable, TypeStringEnum } from "../../util/TypeBoxUtil";
import { YYYYdMMdDD } from "../../util/parseDate";
import { AllForms } from "../forms/all-forms";
import { TypeSECForm } from "../submissions/EnititySubmissionSchema";

export interface CompanyFacts {
  cik: number;
  entityName: string;
  facts: Facts;
}

type Group = string;
export type Facts = Record<Group, FactInfo>;
type Name = string;
type FactInfo = Record<Name, NameInfo>;
interface NameInfo {
  label: string;
  description: string;
  units: UnitInfo;
}
type Unit = string;
type UnitInfo = Record<Unit, FactSummary[]>;

export interface FactSummary {
  end: YYYYdMMdDD;
  val: number;
  accn: string;
  // EDGAR reports period-agnostic facts (e.g. DEF 14A pay-vs-performance) with
  // fy/fp explicitly null. Keep the in-memory shape faithful; the storage
  // boundary coalesces to sentinels so the primary key stays NOT NULL.
  fy: number | null;
  fp: FP | null;
  form: AllForms;
  filed: YYYYdMMdDD;
  start?: YYYYdMMdDD;
  frame?: Frame;
}

// EDGAR company-facts emit more fiscal-period codes than the four quarters +
// full year: `CY` (calendar-year facts) and `H1`/`H2` (half-year) appear in the
// bulk companyfacts dataset. All fit the 2-char `fp` column.
export const FP = ["FY", "Q1", "Q2", "Q3", "Q4", "CY", "H1", "H2"] as const;
export type FP = (typeof FP)[number];

const FP_SET: ReadonlySet<string> = new Set(FP);

/**
 * The raw companyfacts JSON is cast to {@link FactSummary} without runtime
 * validation, but EDGAR reports period-agnostic facts with `fp` as an empty
 * string (or, rarely, an unrecognized code) rather than the documented FY/Q1–Q4
 * set. Map anything outside the known codes to `null` so it flows through the
 * task-input schema; the storage boundary coalesces `null` to the "" PK
 * sentinel. Keeps one odd fact from failing a CIK's entire facts batch.
 */
export function normalizeFp(fp: unknown): FP | null {
  return typeof fp === "string" && FP_SET.has(fp) ? (fp as FP) : null;
}

export const FactoidSchema = Type.Object({
  cik: Type.Number({ format: "cik", minimum: 0 }),
  grouping: Type.String({ maxLength: 20 }), // dei, us-gaap, ifrs-full, srt, invest, ...
  name: Type.String(),
  filed_date: TypeDate(),
  form: TypeSECForm(),
  val_unit: Type.String({ maxLength: 32 }),
  val: Type.Number(),
  frame: TypeNullable(Type.String({ maxLength: 12 })),
  accession_number: Type.String({ maxLength: 20 }),
  start_date: TypeNullable(TypeDate()),
  // end_date is nullable to match EDGAR's period-agnostic facts (some pay-vs-
  // performance rows arrive without an end period). StoreCompanyFactsTask
  // derives the fy sentinel from end_date when present, so making this
  // nullable is a prerequisite for the sentinel derivation.
  end_date: TypeNullable(TypeDate()),
  // Nullable at the boundary: EDGAR emits `null` for period-agnostic facts;
  // StoreCompanyFactsTask coalesces to a deterministic sentinel derived from
  // end_date (fy) or an empty string (fp) before hitting the primary key.
  fy: TypeNullable(Type.Number({ format: "year" })),
  fp: TypeNullable(TypeStringEnum(FP)),
});

export type Factoid = Static<typeof FactoidSchema>;
