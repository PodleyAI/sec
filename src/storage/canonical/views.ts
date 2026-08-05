/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SQL DDL for the `current_canonical_*` views. These filter the underlying
 * canonical/link/junction tables to rows whose `resolver_version` matches
 * the active resolver slot's semver. Downstream consumers (analysis,
 * exports, the API layer) read through these views so a resolver dev cycle
 * doesn't poison their reads.
 *
 * The view definitions are intentionally portable SQL — no SQLite-specific
 * syntax. They are executed via the same `setupAllDatabases` flow that
 * creates the tables.
 */
export const CURRENT_CANONICAL_VIEW_DDL: ReadonlyArray<string> = [
  `CREATE VIEW IF NOT EXISTS current_canonical_person AS
   SELECT cp.* FROM canonical_person cp
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'person'
      AND cv.slot = 'current'
      AND cv.semver = cp.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_canonical_company AS
   SELECT cc.* FROM canonical_company cc
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'company'
      AND cv.slot = 'current'
      AND cv.semver = cc.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_person_identity_link AS
   SELECT pil.* FROM person_identity_link pil
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'person'
      AND cv.slot = 'current'
      AND cv.semver = pil.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_company_identity_link AS
   SELECT cil.* FROM company_identity_link cil
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'company'
      AND cv.slot = 'current'
      AND cv.semver = cil.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_canonical_person_address AS
   SELECT j.* FROM canonical_person_address j
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'person'
      AND cv.slot = 'current'
      AND cv.semver = j.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_canonical_person_phone AS
   SELECT j.* FROM canonical_person_phone j
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'person'
      AND cv.slot = 'current'
      AND cv.semver = j.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_person_role AS
   SELECT pr.* FROM person_role pr
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'person'
      AND cv.slot = 'current'
      AND cv.semver = pr.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_canonical_company_address AS
   SELECT j.* FROM canonical_company_address j
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'company'
      AND cv.slot = 'current'
      AND cv.semver = j.resolver_version`,
  `CREATE VIEW IF NOT EXISTS current_canonical_company_phone AS
   SELECT j.* FROM canonical_company_phone j
     JOIN component_versions cv
       ON cv.component_kind = 'resolver'
      AND cv.component_id = 'company'
      AND cv.slot = 'current'
      AND cv.semver = j.resolver_version`,
];

/**
 * Names of the views created by {@link CURRENT_CANONICAL_VIEW_DDL}, in the same
 * order. `db reset` drops these by name so it never has to parse DDL; a drift
 * test keeps the two arrays in sync.
 */
export const CURRENT_CANONICAL_VIEW_NAMES: ReadonlyArray<string> = [
  "current_canonical_person",
  "current_canonical_company",
  "current_person_identity_link",
  "current_company_identity_link",
  "current_canonical_person_address",
  "current_canonical_person_phone",
  "current_person_role",
  "current_canonical_company_address",
  "current_canonical_company_phone",
];
