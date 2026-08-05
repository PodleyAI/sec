/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeNullable } from "../../util/TypeBoxUtil";
import { TypeSecCik } from "../../util/TypeSecCik";

export const CompanyFactsSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - unique identifier for entity" }),
  grouping: Type.String({
    maxLength: 20,
    description: "Facts grouping category (dei, us-gaap, ifrs-full, srt, invest, ...)",
  }),
  name: Type.String({
    description: "Fact name",
  }),
  filed_date: Type.String({
    maxLength: 10,
    description: "Filing date (YYYY-MM-DD format)",
  }),
  form: Type.String({
    maxLength: 10,
    description: "Form type",
  }),
  val_unit: Type.String({
    maxLength: 32,
    description: "Value unit",
  }),
  frame: TypeNullable(
    Type.String({
      description: "Reporting frame (e.g., CY2023Q1)",
    })
  ),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number",
  }),
  start_date: TypeNullable(
    Type.String({
      description: "Period start date",
    })
  ),
  end_date: TypeNullable(
    Type.String({
      description: "Period end date",
    })
  ),
  val: Type.Number({
    description: "Fact value",
  }),
  // `fy`/`fp` are part of the primary key, so they must stay NOT NULL. EDGAR
  // reports null `fy`/`fp` for period-agnostic facts (e.g. DEF 14A
  // pay-vs-performance figures); those are coalesced to the sentinels `0` / ""
  // at the storage boundary (see StoreCompanyFactsTask) to keep the key stable
  // and replays idempotent.
  fy: Type.Integer({
    description: "Fiscal year (fallback: year-from-end_date, then 0 sentinel)",
  }),
  fp: Type.String({
    maxLength: 2,
    description: "Fiscal period (empty-string sentinel when null)",
  }),
});

export type CompanyFact = Static<typeof CompanyFactsSchema>;

export const CompanyFactsPrimaryKeyNames = [
  "cik",
  "grouping",
  "name",
  "accession_number",
  "val_unit",
  "fy",
  "fp",
  "val",
] as const;

export type CompanyFactsRepositoryStorage = ITabularStorage<
  typeof CompanyFactsSchema,
  typeof CompanyFactsPrimaryKeyNames,
  CompanyFact
>;

export const COMPANY_FACTS_REPOSITORY_TOKEN = createServiceToken<CompanyFactsRepositoryStorage>(
  "sec.storage.companyFactsRepository"
);
