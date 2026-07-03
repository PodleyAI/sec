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
  // EDGAR reports `fy`/`fp` as null for period-agnostic facts (e.g. the
  // pay-vs-performance `NetIncomeLoss` figures disclosed on DEF 14A).
  fy: number | null;
  fp: FP | null;
  form: AllForms;
  filed: YYYYdMMdDD;
  start?: YYYYdMMdDD;
  frame?: Frame;
}

export const FP = ["FY", "Q1", "Q2", "Q3", "Q4"] as const;
export type FP = (typeof FP)[number];

export const FactoidSchema = Type.Object({
  cik: Type.Number({ format: "cik", minimum: 0 }),
  grouping: Type.String({ maxLength: 10 }), // dei or us-gaap
  name: Type.String(),
  filed_date: TypeDate(),
  form: TypeSECForm(),
  val_unit: Type.String({ maxLength: 12 }),
  val: Type.Number(),
  frame: TypeNullable(Type.String({ maxLength: 12 })),
  accession_number: Type.String({ maxLength: 20 }),
  start_date: TypeNullable(TypeDate()),
  end_date: TypeDate(),
  fy: TypeNullable(Type.Number({ format: "year" })),
  fp: TypeNullable(TypeStringEnum(FP)),
});

export type Factoid = Static<typeof FactoidSchema>;
