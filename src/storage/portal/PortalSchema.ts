/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

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
export type PortalRepositoryStorage = ITabularStorage<
  typeof PortalSchema,
  typeof PortalPrimaryKeyNames,
  Portal
>;

/**
 * Dependency injection tokens for repositories
 */
export const PORTAL_REPOSITORY_TOKEN = createServiceToken<PortalRepositoryStorage>(
  "sec.storage.portalRepository"
);
