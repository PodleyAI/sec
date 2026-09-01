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
  /**
   * The portal that took over this registration, when a later CFPORTAL filing
   * says so — set on the PREDECESSOR, pointing forward to the surviving filer.
   *
   * Derived, never curated: it comes from a succession block whose
   * `acquiredPortalFileNumber` resolves to a DIFFERENT CIK. A self-referential
   * succession is a rename EDGAR handled by keeping the CIK, which produces no
   * duplicate registration and must not set this.
   *
   * It is the only thing that says an older registration stopped. `live` means
   * "did not file CFPORTAL-W", and a predecessor commonly never files one — its
   * successor's filing is the whole of the evidence — so a consumer reading
   * `live` alone shows two live portals where there is one.
   */
  succeeded_by_cik: Type.Optional(TypeNullable(TypeSecCik())),
  as_of: Type.Optional(
    TypeNullable(
      Type.String({
        format: "date",
        description:
          "Filing date of the filing that last shaped this row; writes guard against out-of-order processing with it",
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
