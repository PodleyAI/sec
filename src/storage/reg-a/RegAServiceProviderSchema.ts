/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { createServiceToken } from "@workglow/util";
import { Static, Type } from "typebox";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Reg-A Service Provider schema - normalized service provider fees per filing
 */
export const RegAServiceProviderSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - unique identifier for entity",
  }),
  file_number: Type.String({
    maxLength: 17,
    description: "SEC file number for the offering",
  }),
  accession_number: Type.String({
    maxLength: 25,
    description: "Filing accession number",
  }),
  provider_type: Type.String({
    maxLength: 30,
    description: "Type of provider: underwriter, sales_commission, finder, auditor, legal, promoter, blue_sky",
  }),
  provider_name: TypeNullable(
    Type.String({
      maxLength: 150,
      description: "Name of the service provider",
    })
  ),
  fees: TypeNullable(
    Type.Number({
      description: "Fees charged by this provider",
    })
  ),
  crd: TypeNullable(
    Type.String({
      maxLength: 9,
      description: "CRD number (for broker-dealers)",
    })
  ),
});

export type RegAServiceProvider = Static<typeof RegAServiceProviderSchema>;

export const RegAServiceProviderPrimaryKeyNames = [
  "cik",
  "file_number",
  "accession_number",
  "provider_type",
] as const;
export type RegAServiceProviderRepositoryStorage = ITabularStorage<
  typeof RegAServiceProviderSchema,
  typeof RegAServiceProviderPrimaryKeyNames,
  RegAServiceProvider
>;

export const REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN =
  createServiceToken<RegAServiceProviderRepositoryStorage>(
    "sec.storage.regAServiceProviderRepository"
  );
