//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";

/**
 * Entity Ticker schema - represents stock tickers and exchanges for entities
 */
export const EntityTickerSchema = Type.Object({
  cik: Type.Integer({
    minimum: 0,
    description: "Central Index Key (CIK) - reference to entity",
  }),
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
export type EntityTickerRepositoryStorage = TabularRepository<
  typeof EntityTickerSchema,
  typeof EntityTickerPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const ENTITY_TICKER_REPOSITORY_TOKEN = createServiceToken<EntityTickerRepositoryStorage>(
  "sec.storage.entityTickerRepository"
);
