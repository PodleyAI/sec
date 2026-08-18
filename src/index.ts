/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Public library surface for `@workglow/sec`.
//
// This barrel IS the package's entry point (package.json `exports["."]` maps to
// the built `dist/index.js`). The `sec` CLI (src/sec.ts) is one consumer of this
// surface; downstream packages that build a *superset* CLI (e.g. `embarc-data`)
// import from here to reuse every SEC command, plus the DI/config, job queue,
// and teardown wiring the CLI relies on.
//
// Everything a superset builds on is re-exported by name below — add to this
// file when a new symbol needs to be public.

// ── CLI construction ────────────────────────────────────────────────────────
// `AddCommands(program)` registers every SEC command *and* installs the
// commander preAction hook that bootstraps DI (EnvToDI/DefaultDI), models,
// providers, and starts the fetch job queue. A superset CLI keeps calling this
// (then adds its own commands) so that bootstrap still fires.
export {
  applyGlobalOptions,
  parseGlobalOptions,
  parseIntOption,
  type GlobalOptions,
} from "./cli/GlobalOptions";
export { isDryRun } from "./cli/isDryRun";
export { isJsonOutput } from "./cli/isJsonOutput";
export * from "./cli/output";
export { runCommand } from "./cli/runCommand";
export { runWorkflowCli } from "./cli/runWorkflow";
export {
  getDbStats,
  isMissingRelationError,
  registerDbStatsTables,
  resetDbStatsTablesForTesting,
  type CountableRepository,
  type DbStatsTable,
  type TableStat,
} from "./cli/queries/DbStatus";
export { AddCommands, DI_EXEMPT_COMMANDS } from "./commands";

export {
  registerSyncLeaf,
  getSyncLeaf,
  listSyncLeaves,
  clearSyncLeavesForTesting,
  runSyncLeaves,
  EMPTY_SYNC_CONTEXT,
  type SyncLeaf,
  type SyncStep,
  type SyncRunContext,
} from "./cli/sync/syncLeaves";
export { addSyncLeafCommands } from "./cli/groups/sync";
export { runFormsSweep } from "./cli/sync/runFormsSweep";
export { SYNC_FORM_DOMAINS, formsForExtractorIds } from "./cli/sync/syncFormDomains";

// ── Config / dependency injection ───────────────────────────────────────────
export * from "./config/Constants";
export { createStorage } from "./config/createStorage";
export { DefaultDI } from "./config/DefaultDI";
export { setupAllDatabases } from "./config/setupAllDatabases";
export { EnvToDI, SecCliConfigurationError } from "./config/EnvToDI";
export { registerSecModels } from "./config/registerModels";
export { registerSecProviders } from "./config/registerProviders";
export * from "./config/tokens";

// ── Fetch job queue + fetch task bases ──────────────────────────────────────
export {
  SecCachedFetchTask,
  type SecCachedFetchTaskInput,
  type response_type,
} from "./task/fetch/SecCachedFetchTask";
export { SecFetchTask } from "./task/fetch/SecFetchTask";
export { getSecJobQueue, setupSecFetchRateLimiter } from "./task/fetch/SecJobQueue";

// ── Lifecycle / teardown ────────────────────────────────────────────────────
// A superset CLI must run these in its own shutdown path (mirroring src/sec.ts)
// or the process hangs on live DB handles and model worker threads.
export { closeDb, getDb } from "./util/db";
export { closePgPool, getPgPool } from "./util/pg";
export { terminateWorkers } from "./util/workers";

// Companion to the two raw-SQL handles above: which of them (if either) a fast
// path may use for the active config and repo. See `resolveSqlBackend`.
export {
  resolveSqlBackend,
  type MaybeDurable,
  type SqlAccess,
  type SqlBackend,
} from "./util/sqlBackend";

// ── Re-exported workglow primitives a superset commonly needs ────────────────
// Saves supersets from taking a direct `workglow` dependency. Routing DI +
// schema access through the barrel is REQUIRED for correctness, not just
// convenience: a downstream package that imported its own `workglow` /
// `typebox` copy would get a *different* `globalServiceRegistry` singleton and a
// different TypeBox instance, so its DI registrations and schemas would not be
// visible to sec. Import these from `@workglow/sec` to share sec's instances.
export { getTaskQueueRegistry, globalServiceRegistry, Sqlite } from "workglow";
export type { ServiceToken } from "workglow";
export { Type, type Static } from "typebox";
export { Value } from "typebox/value";
export { Task, Workflow } from "workglow";
export type { IExecuteContext, TaskOutput } from "workglow";
export { isStaleByAsOf } from "./util/asOfGuard";
export type { TaskPorts } from "./task/taskPorts";

// ── Extension seams for downstream feature packages ─────────────────────────
// A downstream feature package (e.g. `embarc-data`) registers its own resolver
// ids and DB-extension repo tokens through these seams, then reuses the
// versioning / observation / normalization internals below.
export {
  getResolverExtension,
  isFamilyResolverId,
  listResolverIds,
  registerResolverExtension,
  type ResolverExtension,
} from "./resolver/resolverExtensions";
export {
  listDatabaseExtensionTokens,
  registerDatabaseExtension,
  registerDatabaseSetupHook,
} from "./config/databaseExtensions";

// ── Family-tier primitives for downstream resolvers ────────────────────────
export { FamilyResolver, normalizeFamilyName } from "./resolver/FamilyResolver";
export {
  CanonicalFamilyAliasRepo,
  type FamilyAliasRow,
} from "./storage/canonical/CanonicalFamilyAliasRepo";

// ── Versioning internals ────────────────────────────────────────────────────
export { computeResolverCoverage } from "./cli/queries/ResolverCoverage";
export { getActiveSlot } from "./storage/versioning/getActiveSlot";
export { VersionRegistry } from "./storage/versioning/VersionRegistry";
export { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./storage/versioning/ComponentVersionSchema";

// ── Observation + filing repos / tokens ─────────────────────────────────────
export { CompanyObservationRepo } from "./storage/observation/CompanyObservationRepo";
export { PersonObservationRepo } from "./storage/observation/PersonObservationRepo";
export { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "./storage/observation/CompanyObservationSchema";
export { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "./storage/observation/PersonObservationSchema";
export { PersonObservationTitleRepo } from "./storage/observation/PersonObservationTitleRepo";
export {
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  type PersonObservationTitle,
} from "./storage/observation/PersonObservationTitleSchema";
export { FILING_REPOSITORY_TOKEN } from "./storage/filing/FilingSchema";

// ── Canonical person identity tier (observation → canonical id, merge aliases)
// The join a downstream superset needs to get from a person observation to the
// canonical id `person_role` and the junction tables are keyed by: the identity
// link resolves it at a given `resolver_version`, and the alias table redirects
// an id that a later merge retired.
export { PersonIdentityLinkRepo } from "./storage/canonical/PersonIdentityLinkRepo";
export {
  PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
  type PersonIdentityLink,
} from "./storage/canonical/PersonIdentityLinkSchema";
export { CanonicalPersonAliasRepo } from "./storage/canonical/CanonicalPersonAliasRepo";
export {
  CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
  type CanonicalPersonAlias,
} from "./storage/canonical/CanonicalAliasSchemas";

// ── Dated person roles (person↔company title tenures) ───────────────────────
export { PersonRoleRepo } from "./storage/canonical/PersonRoleRepo";
export {
  PERSON_ROLE_REPOSITORY_TOKEN,
  type PersonRole,
} from "./storage/canonical/PersonRoleSchema";

// ── Canonical company (CIK/CRD → canonical entity) ──────────────────────────
// Exposes the resolved company tier so a downstream superset (e.g. embarc-data)
// can map a Form D issuer CIK to its canonical company — `findByResolverAndCik`
// — and join that to its own records (startup.canonical_company_id).
export { CanonicalCompanyRepo } from "./storage/canonical/CanonicalCompanyRepo";
export {
  CANONICAL_COMPANY_REPOSITORY_TOKEN,
  type CanonicalCompany,
} from "./storage/canonical/CanonicalCompanySchema";

// ── Normalization helpers ───────────────────────────────────────────────────
export {
  generateCompanyHash,
  hasCompanyEnding,
  normalizeCompanyName,
} from "./storage/company/CompanyNormalization";
export { companyFamilyName } from "./storage/company/CompanyFamilyName";
export { normalizeAddress, type AddressImport } from "./storage/address/AddressNormalization";
export { normalizePhone } from "./storage/phone/PhoneNormalization";

// ── Typed schema / util helpers ─────────────────────────────────────────────
export { isBadPersonField } from "./types/edgar/bad-data";
export { TypeSecCik } from "./sec/submissions/EnititySubmissionSchema";
export { TypeNullable } from "./util/TypeBoxUtil";
export { streamMatchingRows } from "./cli/queries/_streamMatches";
export { KeyedMutex } from "./util/KeyedMutex";
export { parseCikSafely as parseCik } from "./util/parseCik";

// ── Re-exported workglow storage primitives a feature package builds on ──────
export {
  createServiceToken,
  InMemoryTabularStorage,
  type AnyTabularStorage,
  type ITabularStorage,
} from "workglow";

// ── Test helpers a downstream feature package needs in its own test setup ────
export {
  clearEnvDerivedTokensForTesting,
  resetDependencyInjectionsForTesting,
} from "./config/TestingDI";
