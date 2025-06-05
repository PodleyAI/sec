//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TabularRepository } from "@podley/storage";
import { createServiceToken, TypeNullable } from "@podley/util";
import { Static, Type } from "@sinclair/typebox";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";

/**
 * Portal schema - represents crowdfunding portals
 */
export const PortalSchema = Type.Object({
  cik: TypeSecCik({
    description: "Central Index Key (CIK) - unique identifier for portal entity",
  }),
  name: Type.Optional(
    TypeNullable(
      Type.String({
        description: "Portal name",
      })
    )
  ),
  brand: Type.Optional(
    TypeNullable(
      Type.String({
        description: "Portal brand name",
      })
    )
  ),
  url: Type.Optional(
    TypeNullable(
      Type.String({
        description: "Portal website URL",
      })
    )
  ),
  live: Type.Optional(
    TypeNullable(
      Type.Boolean({
        description: "Whether the portal is currently live/active",
      })
    )
  ),
});

export type Portal = Static<typeof PortalSchema>;

/**
 * Portal repository storage type and primary key definitions
 */
export const PortalPrimaryKeyNames = ["cik"] as const;
export type PortalRepositoryStorage = TabularRepository<
  typeof PortalSchema,
  typeof PortalPrimaryKeyNames
>;

/**
 * Dependency injection tokens for repositories
 */
export const PORTAL_REPOSITORY_TOKEN = createServiceToken<PortalRepositoryStorage>(
  "sec.storage.portalRepository"
);
