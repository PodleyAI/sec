/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";

export const EXTRACTOR_RUN_OUTCOMES = ["success", "partial", "failure"] as const;
export type ExtractorRunOutcome = (typeof EXTRACTOR_RUN_OUTCOMES)[number];

export const ExtractorRunSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key" }),
  accession_number: Type.String({
    maxLength: 20,
    description: "SEC accession number",
  }),
  form: Type.String({
    maxLength: 32,
    description: "Form type (e.g. 'D', '1-A')",
  }),
  extractor_id: Type.String({
    maxLength: 64,
    description: "Matches component_versions.component_id for component_kind='extractor'",
  }),
  extractor_version: Type.String({
    maxLength: 32,
    description: "Semver of the extractor that produced this run",
  }),
  slot_at_run: Type.Union([Type.Literal("current"), Type.Literal("next")], {
    description: "Which slot the version occupied at the time the run executed",
  }),
  ran_at: Type.String({
    description: "ISO 8601 timestamp",
  }),
  success: Type.Boolean({
    description: "Whether the extractor completed without error (mirrors outcome === 'success')",
  }),
  outcome: Type.Union([Type.Literal("success"), Type.Literal("partial"), Type.Literal("failure")], {
    description:
      "Tri-state run result: success (every section persisted), partial (parse+store ran but at least one section dead-lettered), failure (filing-level failure).",
  }),
  error: Type.Union([Type.String({ maxLength: 4096 }), Type.Null()], {
    description: "Error message if success=false, else null",
  }),
});

export type ExtractorRun = Static<typeof ExtractorRunSchema>;

export const ExtractorRunPrimaryKeyNames = [
  "cik",
  "accession_number",
  "extractor_id",
  "extractor_version",
] as const;

export type ExtractorRunRepositoryStorage = ITabularStorage<
  typeof ExtractorRunSchema,
  typeof ExtractorRunPrimaryKeyNames,
  ExtractorRun
>;

export const EXTRACTOR_RUN_REPOSITORY_TOKEN = createServiceToken<ExtractorRunRepositoryStorage>(
  "sec.storage.extractorRunRepository"
);
