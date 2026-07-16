/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Derived link from a Form D filing to an accredited-investor portal whose
 * fingerprint (name/phone/address signal) the filing matched. Fully
 * recomputable from observations + signals, so re-attribution overwrites rows
 * in place; one row per (accession, portal) even when several signals hit.
 */
export const FormDPortalAttributionSchema = Type.Object({
  accession_number: Type.String({ maxLength: 32 }),
  portal_id: Type.String({ maxLength: 128 }),
  cik: TypeNullable(TypeSecCik({ description: "Filer CIK of the Form D" })),
  filing_date: TypeNullable(
    Type.String({ format: "date", description: "Filing date when known at attribution time" })
  ),
  matched_signal_type: Type.String({
    maxLength: 16,
    description: "Strongest matching signal kind (address > phone > name)",
  }),
  matched_signal_value: Type.String({ maxLength: 512 }),
  matches: Type.String({
    description: "JSON array of every {signal_type, signal_value, via} that matched this portal",
  }),
  attributor_version: Type.String({ maxLength: 32 }),
  created_at: Type.String({ description: "ISO timestamp of the attribution write" }),
});

export type FormDPortalAttribution = Static<typeof FormDPortalAttributionSchema>;

export const FormDPortalAttributionPrimaryKeyNames = ["accession_number", "portal_id"] as const;

export type FormDPortalAttributionRepositoryStorage = ITabularStorage<
  typeof FormDPortalAttributionSchema,
  typeof FormDPortalAttributionPrimaryKeyNames,
  FormDPortalAttribution
>;

export const FORM_D_PORTAL_ATTRIBUTION_REPOSITORY_TOKEN =
  createServiceToken<FormDPortalAttributionRepositoryStorage>(
    "sec.storage.formDPortalAttributionRepository"
  );
