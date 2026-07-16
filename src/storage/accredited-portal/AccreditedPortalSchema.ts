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
import { generateCompanyHash } from "../company/CompanyNormalization";

/**
 * Accredited-investor portal (AngelList, Forge, EquityZen, ...). Unlike Reg CF
 * portals these platforms never register with the SEC, so rows are curated
 * (seeded from a committed list, then maintained via the CLI) and keyed by a
 * name-derived slug rather than a CIK.
 */
export const AccreditedPortalSchema = Type.Object({
  portal_id: Type.String({
    maxLength: 128,
    description: "Stable slug derived from the portal name (e.g. 'angellist', 'forge-global')",
  }),
  name: Type.String({ maxLength: 256, description: "Portal display name" }),
  brand: TypeNullable(Type.String({ maxLength: 256, description: "Parent/successor brand" })),
  url: TypeNullable(Type.String({ maxLength: 512, description: "Portal website URL" })),
  live: TypeNullable(Type.Boolean({ description: "Whether the portal is currently operating" })),
  cik: TypeNullable(
    TypeSecCik({ description: "EDGAR CIK of the portal operator itself, when known" })
  ),
  notes: TypeNullable(Type.String({ description: "Curation notes" })),
});

export type AccreditedPortal = Static<typeof AccreditedPortalSchema>;

export const AccreditedPortalPrimaryKeyNames = ["portal_id"] as const;

export type AccreditedPortalRepositoryStorage = ITabularStorage<
  typeof AccreditedPortalSchema,
  typeof AccreditedPortalPrimaryKeyNames,
  AccreditedPortal
>;

export const ACCREDITED_PORTAL_REPOSITORY_TOKEN =
  createServiceToken<AccreditedPortalRepositoryStorage>("sec.storage.accreditedPortalRepository");

/** Derives the stable portal_id slug from a portal display name. */
export function slugifyPortalId(name: string): string {
  return generateCompanyHash(name);
}
