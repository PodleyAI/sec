/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Point-in-time ticker mention read from an immutable filing. Distinct from the
 * mutable `EntityTicker` current-snapshot table: this is the longitudinal series
 * keyed by issuer CIK + filing date. `ticker` is stored EXACT (never normalized);
 * maxLength 16 preserves suffixed symbols like "GSAH.U" / "GSAH WS".
 */
export const IssuerTickerSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  exchange: Type.String({ maxLength: 32 }),
  ticker: Type.String({ maxLength: 16 }),
  cik: TypeNullable(TypeSecCik()),
  filing_date: TypeNullable(Type.String({ maxLength: 32 })),
  security_type: TypeNullable(Type.String({ maxLength: 128 })),
  is_primary: Type.Boolean(),
  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type IssuerTicker = Static<typeof IssuerTickerSchema>;

export const IssuerTickerPrimaryKeyNames = [
  "extractor_id",
  "accession_number",
  "exchange",
  "ticker",
] as const;

export type IssuerTickerRepositoryStorage = ITabularStorage<
  typeof IssuerTickerSchema,
  typeof IssuerTickerPrimaryKeyNames,
  IssuerTicker
>;

export const ISSUER_TICKER_REPOSITORY_TOKEN = createServiceToken<IssuerTickerRepositoryStorage>(
  "sec.storage.issuerTickerRepository"
);
