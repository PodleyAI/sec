/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../util/TypeSecCik";

/**
 * Entity Ticker schema - represents stock tickers and exchanges for entities
 */
export const EntityTickerSchema = Type.Object({
  cik: TypeSecCik({ description: "Central Index Key (CIK) - reference to entity" }),
  ticker: Type.String({
    maxLength: 8,
    description: "Stock ticker symbol",
  }),
  exchange: Type.String({
    maxLength: 20,
    description: "Stock exchange name",
  }),
});

export type EntityTicker = Static<typeof EntityTickerSchema>;

/**
 * Entity Ticker repository storage type and primary key definitions
 */
export const EntityTickerPrimaryKeyNames = ["cik", "ticker", "exchange"] as const;
export type EntityTickerRepositoryStorage = ITabularStorage<
  typeof EntityTickerSchema,
  typeof EntityTickerPrimaryKeyNames,
  EntityTicker
>;

/**
 * Dependency injection tokens for repositories
 */
export const ENTITY_TICKER_REPOSITORY_TOKEN = createServiceToken<EntityTickerRepositoryStorage>(
  "sec.storage.entityTickerRepository"
);
