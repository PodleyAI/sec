/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Public library surface for `@workglow/sec`.
//
// This barrel IS the package's entry point (package.json `exports["."]` maps to
// the built `dist/index.js`). The `sec` CLI (src/sec.ts) is one consumer of this
// surface; downstream packages that build a *superset* CLI import from here to
// reuse every SEC command, plus the DI/config, job queue, and teardown wiring
// the CLI relies on.
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
  parseOutputFormat,
  type GlobalOptions,
  type OutputFormat,
} from "./cli/GlobalOptions";
export { isDryRun } from "./cli/isDryRun";
export { isJsonOutput } from "./cli/isJsonOutput";
export * from "./cli/output";
export {
  getDbStats,
  isMissingRelationError,
  registerDbStatsTables,
  resetDbStatsTablesForTesting,
  type CountableRepository,
  type DbStatsTable,
  type TableStat,
} from "./cli/queries/DbStatus";
export { runCommand } from "./cli/runCommand";
export { runWorkflowCli } from "./cli/runWorkflow";
export { AddCommands, isDiExemptCommand } from "./commands";

export { addSyncLeafCommands } from "./cli/groups/sync";
export { runFormsSweep } from "./cli/sync/runFormsSweep";
export {
  SYNC_FORM_DOMAINS,
  expandFormTypes,
  formsForExtractorIds,
} from "./cli/sync/syncFormDomains";
export {
  EMPTY_SYNC_CONTEXT,
  SHARD_LEAF_OPTION,
  clearSyncLeavesForTesting,
  getSyncLeaf,
  listSyncLeaves,
  registerSyncLeaf,
  runSyncLeaves,
  type SyncLeaf,
  type SyncLeafOption,
  type SyncLeafOptionValues,
  type SyncLeafOptions,
  type SyncRunContext,
  type SyncStep,
} from "./cli/sync/syncLeaves";

// ── Config / dependency injection ───────────────────────────────────────────
export { bootstrapSecRuntime } from "./config/bootstrapSecRuntime";
export * from "./config/Constants";
export { createStorage } from "./config/createStorage";
export { DefaultDI } from "./config/DefaultDI";
export { EnvToDI, SecCliConfigurationError } from "./config/EnvToDI";
export { registerSecModels } from "./config/registerModels";
export { registerSecProviders } from "./config/registerProviders";
export { registerSecTasks } from "./config/registerTasks";
export { setupAllDatabases } from "./config/setupAllDatabases";
export {
  defineStorage,
  registerStorages,
  type StorageDefinition,
  type StorageFactory,
} from "./config/storageRegistry";
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
// `typebox` copy would get a *different* `globalServiceRegistry` singleton, a
// different TypeBox instance, and a different `registerSafeFetch` slot, so its
// DI registrations, schemas, and fetch stubs would not be visible to sec.
// Import these from `@workglow/sec` to share sec's instances.
export { Type, type Static } from "typebox";
export { Value } from "typebox/value";
export {
  FetchUrlTask,
  Sqlite,
  Task,
  TaskError,
  TaskRegistry,
  Workflow,
  getTaskQueueRegistry,
  globalServiceRegistry,
  registerSafeFetch,
  uuid4,
} from "workglow";
export type {
  DataPorts,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  IExecuteContext,
  ITask,
  PageCursor,
  SafeFetchFn,
  SearchCriteria,
  ServiceToken,
  TaskOutput,
} from "workglow";
export type { TaskPorts } from "./task/taskPorts";
export { isStaleByAsOf } from "./util/asOfGuard";

// ── Extension seams for downstream feature packages ─────────────────────────
// A downstream feature package registers its own resolver ids and
// DB-extension repo tokens through these seams, then reuses the
// versioning / observation / normalization internals below.
export {
  listDatabaseExtensionTokens,
  registerDatabaseExtension,
  registerDatabaseSetupHook,
  registerDatabaseViews,
} from "./config/databaseExtensions";
export { registerSecFormExtractors } from "./config/registerFormExtractors";
export {
  clearResolverExtensionsForTesting,
  getResolverExtension,
  isFamilyResolverId,
  listResolverIds,
  registerResolverExtension,
  type ResolverExtension,
} from "./resolver/resolverExtensions";
export { selectRegAReportDocument } from "./sec/forms/exempt-offerings/regAReportDocument";
export {
  allRegisteredExtractorIds,
  allRegisteredForms,
  extractorIdsForForm,
  extractorKey,
  extractorReadsFullSubmission,
  extractorsForForm,
  formExtractorRegistryGeneration,
  formHandledByExtractor,
  formHasExtractor,
  formNeedsDocument,
  formNeedsFullSubmission,
  formsForExtractorKeys,
  getFormExtractor,
  listFormExtractorKeys,
  registerFormExtractor,
  type FormExtractor,
  type FormExtractorStoreArgs,
  type FormExtractorStoreReport,
  type FullSubmissionProbe,
} from "./sec/forms/formExtractors";
export { parseNumeric } from "./sec/html/parseNumeric";
// `filingRunKey` travels with the repo because it is the key format
// `successfulRunKeysForFilings` answers in. A caller asking whether a filing
// already ran must build its lookup key the same way the repo built the set,
// so the format is shared rather than restated on both sides of that call.
export { ExtractorRunRepo, filingRunKey } from "./storage/versioning/ExtractorRunRepo";
// `GATE_VERDICTS` and `isGateDecline` travel with the repo because the handlers
// that KNOW a gate declined are registered from outside this package while the
// table stays here: a downstream `store` reports a verdict from this vocabulary
// and the dispatcher records it, so both halves read the same one.
export { ExtractionDeadLetterRepo } from "./storage/dead-letter/ExtractionDeadLetterRepo";
export { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "./storage/dead-letter/ExtractionDeadLetterSchema";
export {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  GATE_VERDICTS,
  isGateDecline,
  type ExtractorGateVerdict,
} from "./storage/versioning/ExtractorRunSchema";
// A resolved `SECTION_NOT_FOUND` trace is the only durable mark that a general
// proxy was looked at and carried no merger section. Every predicate that
// selects merger proxies has to count that as answered or it re-reads the same
// filings forever, so the query is shared rather than restated per caller.
export { loadAnsweredMergerSections } from "./storage/dead-letter/answeredMergerSections";

// ── EDGAR HTML parser + section vocabulary ──────────────────────────────────
// The form-agnostic HTML → Document pass, plus what a consumer needs to work
// with what it returns: the block list and its `[start, end)` spans back into
// the filing HTML, the drop report, and the heading vocabulary the parser and
// the form segmenters share. Pure and synchronous — nothing here reads DI, the
// database, or a model.
export type { DroppedBlock } from "./sec/html/DePaginator";
export { isHidden, stripNonProse } from "./sec/html/domPrep";
export {
  parseEdgarHtml,
  parseEdgarHtmlWithTrace,
  type EdgarParseTrace,
} from "./sec/html/parseEdgarHtml";
export {
  S1_SECTIONS,
  SECTION_HEADING_PATTERNS,
  type S1SectionName,
} from "./sec/html/sectionVocabulary";
export { subtreeSourceSpan, type SourceSpanIndex } from "./sec/html/sourceSpanIndex";
export type { EdgarBlock, SourceSpan } from "./sec/html/types";

// ── Submission parsing an out-of-package extractor starts from ──────────────
// The SGML envelope splitters. A full-submission `.txt` is a concatenation of
// tagged documents; these cut it into the primary document, the exhibits with
// their `<TYPE>`/`<DESCRIPTION>` manifest, and the XBRL instance. Pure and
// synchronous, like the HTML parser above — nothing here reads DI, the
// database, or a model — and this shape is what a form extractor is handed
// before it looks at any HTML.
export {
  formatExhibitDetail,
  parseEightKSubmission,
  parseRegistrationSubmission,
  parseSubmissionExhibits,
  type FormS1Parsed,
  type SubmissionExhibit,
} from "./sec/forms/registration-statements/s1/parseSubmission";

// ── Section segmentation over the parsed document tree ──────────────────────
// Cuts the tree `parseEdgarHtml` returns into the sections the vocabulary
// above names. A `Section` carries the GFM body plus the bounding
// `[start, end)` span back into the filing HTML — a range to highlight, never
// a slice to re-derive the text from. `DocumentSegmenter` is the interface, so
// a consumer can substitute its own cutter and still be read by everything
// that takes sections.
export type {
  DocumentSegmenter,
  Section,
} from "./sec/forms/registration-statements/s1/DocumentSegmenter";
export { DocumentTreeSegmenter } from "./sec/forms/registration-statements/s1/DocumentTreeSegmenter";

// ── Extraction-call configuration ───────────────────────────────────────────
// The sampling temperature every extraction call must pass — extraction is
// transcription, so it is 0 unless an operator lifts it — and the model record
// standing in for the no-model deterministic pass. An extractor built outside
// this package reads both from here rather than re-deriving them, so one
// environment variable still governs the whole corpus. `DeadLetterReasonCode`
// is the vocabulary a failed section is recorded under by the
// `ExtractionDeadLetterRepo` above.
export { getExtractionTemperature } from "./config/extractionTemperature";
export { deterministicModelRecord } from "./config/registerModels";
export type { DeadLetterReasonCode } from "./storage/dead-letter/ExtractionDeadLetterSchema";

// ── Writing observations from an out-of-package extractor ───────────────────
// `buildObserveOnlyEntityObserver` wires an `EntityObserver` over the three
// observation repositories, so a form module does not repeat the ceremony. It
// records what a filing said and stops there; the canonical id a name resolves
// to is a batch pass's answer over the stored observations, not something a
// form module reads back as it stores.
// `COMPLETE_ROSTER_ROLE_SCOPES` names the scopes whose filings list everyone
// holding the role, and so the only ones where a later filing's silence may
// end a tenure. It is shared rather than restated because a roster closure
// pass and anything recomputing tenures from stored evidence must agree on the
// set exactly.
//
// Resolving those observations into canonical ids — the corpus-wide pass and
// the one-filing variant a module uses when it must read an id back before it
// returns — belongs to the package that owns the identity tier, and is not
// exported from here.

// ── What a package owning the family tier builds on ─────────────────────────
// The alias TSV format, the `sec issuer` group, and the unique-constraint
// predicate a resolver's mint race turns on. All three are this package's and
// stay here; the family tier that uses them does not.
export { issuerCommandGroup } from "./commands/issuerGroup";
export { formatAliasLine, formatAliasTsv, parseAliasTsv } from "./task/canonical/aliasTsv";
export type { AliasExportRow, AliasTsvParse } from "./task/canonical/aliasTsv";
export { isUniqueConstraintError } from "./util/isUniqueConstraintError";

// ── What a package owning the identity tier is built on ─────────────────────
// The observation side stays here — a filing's own account of who it named — so
// the tier that resolves those observations reads them, their roster verdicts,
// and the title/name normalizers whose single definition decides how a tenure
// is keyed. A second copy of any of these drifting would silently re-partition
// the tier it feeds.
export { canonicalRoleTitles, normalizePersonNameParts } from "./resolver/EntityObserver";
export { resolverIds } from "./resolver/resolverIds";
export { isCompleteRosterRoleScope } from "./resolver/roleScopes";
export { personDisplayParts } from "./storage/person/PersonNormalization";
export { isValidSemver } from "./storage/versioning/VersionRegistry";
// The reaper itself, so a package registering a hook can test what its hook is
// handed rather than trusting the seam blind.
export { reapStaleObservations } from "./resolver/reapStaleObservations";
// The child-process CLI harness, so a package whose commands attach to this
// one's groups drives them the same way this package drives its own.
export type { QueryResult } from "./cli/queries/EntityQuery";
export { cliEnv, runCliProcess } from "./cli/testing/runCliProcess";
export type { CliRunResult } from "./cli/testing/runCliProcess";
export {
  clearObservationReapHooksForTesting,
  getObservationReapHooks,
  registerObservationReapHook,
} from "./resolver/observationReapHooks";
export type { ObservationReapHook, ReapedObservation } from "./resolver/observationReapHooks";
export { RoleRosterCompletenessRepo } from "./storage/roster/RoleRosterCompletenessRepo";
export {
  ROLE_ROSTER_COMPLETENESS_REPOSITORY_TOKEN,
  RoleRosterCompletenessPrimaryKeyNames,
  RoleRosterCompletenessSchema,
  type RoleRosterCompleteness,
} from "./storage/roster/RoleRosterCompletenessSchema";
export { queryResultSchema } from "./task/query/queryResultSchema";

export { buildObserveOnlyEntityObserver } from "./resolver/buildObserveOnlyEntityObserver";
export { EntityObserver } from "./resolver/EntityObserver";
export type { ObservationResult, ObserveOnlyEntityObserver } from "./resolver/EntityObserver";
export { COMPLETE_ROSTER_ROLE_SCOPES } from "./resolver/roleScopes";

// ── 8-K item codes that mark a SPAC letter of intent or redemption ──────────
// Which `<ITEM>` codes on an 8-K make it worth reading for each event. These
// are structured filing metadata, not a judgement about the text, which is why
// they stay here and are read by whatever does the reading.
export { LOI_TRIGGER_ITEMS } from "./sec/forms/miscellaneous-filings/spac8kLoiTriggers";
export { REDEMPTION_TRIGGER_ITEMS } from "./sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";

// ── Guards between what a model returned and what gets persisted ────────────
// A model returns text; these decide what may become a row, and they belong in
// the persist path rather than in a prompt — an instruction is a request, a
// guard is a fact. The name filters reject an issuer's own name echoed back as
// a family, a placeholder standing in for an unnamed company, and a person
// name too long to be one; `legalFormTrailingCanonical` is the trailing
// legal-form table that says a string names an entity at all.
// `splitParentClause` separates "X, a subsidiary of Y" into the entity and the
// relation that named it. `assertWithinDeclaredBounds` checks a whole batch
// against the storage schema's own `maxLength`s BEFORE any of it is written: a
// row that throws part-way through a multi-storage persist cannot be rolled
// back, and would leave a section both partly stored and dead-lettered.
export { isCompanyFamilyPrefixEcho } from "./storage/company/CompanyFamilyName";
export { isUnnamedCompanyName } from "./storage/company/CompanyNormalization";
export { parentClauseSourceContext, splitParentClause } from "./storage/company/splitParentClause";
export { assertWithinDeclaredBounds } from "./util/declaredBounds";
export { legalFormProseSuffixAlternation, legalFormTrailingCanonical } from "./util/legalForms";
export { MAX_PERSON_NAME_CHARS, isOverlongPersonName } from "./util/personNameBounds";

// ── Model-call tracing ──────────────────────────────────────────────────────
// Off unless `SEC_TRACE_DIR` names a directory, and one memoized environment
// read per call when it is — extraction is the expensive path here, and a
// tracing facility that cost anything while disabled would be left off. An
// extractor records each attempt so the source-span verifier can measure what
// was sent against what came back; `CallOutcome` is the same vocabulary a
// failed section dead-letters by.
export { isCallTracing, recordCall } from "./verify/callTrace";
export type { CallOutcome, CallValidationAttempt } from "./verify/callTrace";
// ── Family-tier primitives for downstream resolvers ────────────────────────
export { normalizeFamilyName } from "./storage/company/CompanyFamilyName";

// ── Versioning internals ────────────────────────────────────────────────────
export { computeResolverCoverage } from "./cli/queries/ResolverCoverage";
export { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./storage/versioning/ComponentVersionSchema";
export { getActiveSlot } from "./storage/versioning/getActiveSlot";
export { VersionRegistry } from "./storage/versioning/VersionRegistry";

// ── Observation + filing repos / tokens ─────────────────────────────────────
export { FILING_REPOSITORY_TOKEN } from "./storage/filing/FilingSchema";
export { CompanyObservationRepo } from "./storage/observation/CompanyObservationRepo";
export {
  COMPANY_OBSERVATION_REPOSITORY_TOKEN,
  CompanyObservationPrimaryKeyNames,
  CompanyObservationSchema,
  type CompanyObservation,
} from "./storage/observation/CompanyObservationSchema";
export { PersonObservationRepo } from "./storage/observation/PersonObservationRepo";
export {
  PERSON_OBSERVATION_REPOSITORY_TOKEN,
  PersonObservationPrimaryKeyNames,
  PersonObservationSchema,
  type PersonObservation,
} from "./storage/observation/PersonObservationSchema";
export { PersonObservationTitleRepo } from "./storage/observation/PersonObservationTitleRepo";
export {
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  type PersonObservationTitle,
} from "./storage/observation/PersonObservationTitleSchema";

// The issuer-side tables a screen outside this package reads to decide which
// CIKs are worth work, and writes its high-water mark back to: the entity row
// and its history carry the name and SIC a screen matches on,
// `processed_submissions` is what keeps a re-run from re-reading every CIK, and
// the SGML-header S-1 classification is the cheap first opinion a text reading
// only has to confirm. Each row type is named beside its token because seeding
// or asserting a row means building one, not just holding the storage.
export {
  S1_CLASSIFICATION_REPOSITORY_TOKEN,
  type S1Classification,
} from "./storage/classification/S1ClassificationSchema";
export {
  ENTITY_HISTORY_REPOSITORY_TOKEN,
  type EntityHistory,
} from "./storage/entity/EntityHistorySchema";
export {
  ENTITY_REPOSITORY_TOKEN,
  type Entity,
  type EntityRepositoryStorage,
} from "./storage/entity/EntitySchema";
export { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "./storage/processing/ProcessedSubmissionsSchema";

// The journal a mutable row's edits are versioned through. A writer outside
// this package records against the same table `sec` reconstructs point-in-time
// state from, rather than keeping a second history nothing else can read.
export { CHANGE_LOG_REPOSITORY_TOKEN } from "./storage/change-tracking/ChangeLogSchema";

// ── Version ceremonies ──────────────────────────────────────────────────────
// So a package owning a resolver kind can drive and test the same lifecycle
// this package's own kinds go through. The canonical person/company tier those
// ceremonies version — the identity links, the aliases, the dated tenures — is
// that package's and is no longer exported from here.
export {
  dropNext,
  dropPrevious,
  promote,
  rollback,
  startDev,
} from "./storage/versioning/ceremonies";
export { VersionEventRepo } from "./storage/versioning/VersionEventRepo";
export {
  VERSION_EVENT_REPOSITORY_TOKEN,
  type VersionEvent,
} from "./storage/versioning/VersionEventSchema";

// ── Normalization helpers ───────────────────────────────────────────────────
export { normalizeAddress, type AddressImport } from "./storage/address/AddressNormalization";
export { companyFamilyName } from "./storage/company/CompanyFamilyName";
export {
  generateCompanyHash,
  hasCompanyEnding,
  normalizeCompanyName,
} from "./storage/company/CompanyNormalization";
export { normalizePhone } from "./storage/phone/PhoneNormalization";

// ── Typed schema / util helpers ─────────────────────────────────────────────
export { streamMatchingRows } from "./cli/queries/_streamMatches";
export { TypeSecCik } from "./sec/submissions/EnititySubmissionSchema";
export { isBadPersonField } from "./types/edgar/bad-data";
export { KeyedMutex } from "./util/KeyedMutex";
export { cleanListedTickers, normalizeListedTicker } from "./util/listedTicker";
// The single-lock primitive `KeyedMutex` is built from, for a writer that keeps
// its own map of locks rather than one keyed mutex — a read-derive-write cycle
// over a mutable row is only atomic if every writer of that row serialises on
// the same in-process lock, so it is shared rather than re-implemented.
export { AsyncMutex } from "./util/AsyncMutex";
export { parseCikSafely as parseCik } from "./util/parseCik";
// `TypeStringEnum` carries a closed value set as JSON Schema `enum` plus the
// runtime membership check, and types the result so the port-schema union still
// accepts it. A storage schema declared outside this package describes such a
// column the same way `sec`'s own schemas do rather than falling back to a bare
// string.
export { TypeNullable, TypeStringEnum } from "./util/TypeBoxUtil";

// ── Re-exported workglow storage primitives a feature package builds on ──────
export {
  InMemoryTabularStorage,
  createServiceToken,
  type AnyTabularStorage,
  type ITabularStorage,
} from "workglow";

// ── Test helpers a downstream feature package needs in its own test setup ────
export {
  clearEnvDerivedTokensForTesting,
  resetDependencyInjectionsForTesting,
} from "./config/TestingDI";
export { clearFormExtractorsForTesting } from "./sec/forms/formExtractors";

// The web console's contributed UI (pickers, panels, status rail, cost badges).
// `AddCommands` already calls this; exported so a superset can compose its own
// registrations beside sec's without importing the module path.
export { registerSecWebUi } from "./web/registerSecWebUi";
// A superset re-runs this once its own commands are on the program: the pass
// reads the tree, so it covers only what was registered when it ran.
export { registerFormatChoiceAnnotations } from "./web/secAnnotations";
// The panel formatting a superset's panels should share rather than re-derive:
// a report that renders `—` for one absence and `null` for another is a report
// nobody trusts to mean anything by either.
export {
  count,
  field,
  isRecord,
  jsonList,
  money,
  recordArray,
  tableFromRecords,
  text,
} from "./web/secPanelFormat";

// ── Form vocabulary, corpus paths and model bookkeeping ─────────────────────
// The rest of what an extractor built outside this package reads from `sec`,
// beside the parser, segmenter and persist guards above. Everything here is
// something `sec` owns because a `sec` reader also depends on it, so an
// out-of-package extractor must share it rather than restate it.
//
// The `extractorIds` sets are structured filing metadata, like the 8-K item
// codes above: which proxy forms carry a definitive general vote, which merger
// proxy forms are optional rather than expected, the section name a merger
// extraction is recorded under, and the Rule 462(b) short-form registrations
// that are a cover page and a signature block — no sections to sweep, so a
// sweep over one records absences that were never there. The worklist that
// selects a filing is keyed by the same vocabulary, so a restatement drifts.
//
// `cachedAccessionDocPath` / `resolvePrimaryDocName` locate the document a
// sweep already downloaded under `SEC_RAW_DATA_FOLDER`, by the same rule the
// fetch layer stored it under; an offline pass over the corpus reads what is
// there rather than reconstructing a filename.
//
// `registerModelIds` registers the ids a run will use, `trySecModelRecord`
// looks one up without throwing when it is not registered, and
// `listPricingForModelId` prices a completed call. `resolveAsset` finds a
// packaged reference file whether it is being read from source or from `dist`.
//
// `MAX_RISK_FACTORS_CHARS` and the chunkers beside it are the same ones this
// package's own span verifier walks, so a chunk boundary an extractor produced
// and one the verifier expects cannot disagree. `normalizeCompany`,
// `normalizePerson` and `foldTypographicPunctuation` are the normalizations a
// stored row is compared through, which is what makes a score computed outside
// this package mean the same thing as one computed inside it.
//
// The repos are the tables a `sec` reader still pins — the issuer/offering tier
// behind `sec issuer deal`, the observation provenance the stale-observation
// reaper walks, and the SGML-header half of the S-1 classification — exposed so
// an extractor writes the row `sec` will read rather than a parallel one.
export { listPricingForModelId } from "./config/listPricing";
export { registerModelIds, trySecModelRecord } from "./config/registerModels";
export { seeksCombinationApproval } from "./sec/forms/proxies-information-statements/seeksCombinationApproval";
export {
  MAX_RISK_FACTORS_CHARS,
  chunkRiskFactorText,
  isRiskCategoryHeading,
  stripHeadingMarkers,
} from "./sec/forms/registration-statements/s1/riskFactorChunks";
export { S1ClassificationRepo } from "./storage/classification/S1ClassificationRepo";
export { normalizeCompany } from "./storage/company/CompanyNormalization";
export type { Filing } from "./storage/filing/FilingSchema";
export { IssuerTickerRepo } from "./storage/offering/IssuerTickerRepo";
export { OfferingTermsRepo } from "./storage/offering/OfferingTermsRepo";
export { SpacPromoteTermsRepo } from "./storage/offering/SpacPromoteTermsRepo";
export { SpacUnitTermsRepo } from "./storage/offering/SpacUnitTermsRepo";
export { normalizePerson } from "./storage/person/PersonNormalization";
export { ObservationProvenanceRepo } from "./storage/provenance/ObservationProvenanceRepo";
export {
  GENERAL_DEFINITIVE_PROXY_FORMS,
  MERGER_PROXY_OPTIONAL_FORMS,
  MERGER_PROXY_SECTION,
  SECTIONLESS_REGISTRATION_FORMS,
} from "./storage/versioning/extractorIds";
export { extractPrimaryDocFromSubmission } from "./task/bootstrap/feedTarball";
export { cachedAccessionDocPath, resolvePrimaryDocName } from "./util/accessionDocPath";
export { foldTypographicPunctuation } from "./util/dataCleaningUtils";
export { resolveAsset } from "./util/resolveAsset";

// ── Scaffolding: expected to be withdrawn, do not build on ──────────────────
// NOT stable API. The extraction work these belong to is being relocated to a
// downstream package one tier at a time, and a tier that has already left has
// to keep reaching back for the tiers that have not. These exports exist only
// so that reaching back is an import rather than a reimplementation, and they
// go away — without deprecation — as soon as the tier behind each one follows
// it out of this package. Anything outside that migration should treat them as
// private and use the surfaces above instead.
//
// `normalizeManagementTitles` is the one left: the title canonicalization stays
// only while this package's inline observe path calls it.
export { normalizeManagementTitles } from "./sec/forms/registration-statements/s1/normalizeTitle";

// ── The rest of what an out-of-package extraction tier reaches for ──────────
// The extraction that reads a filing's PROSE — a model's reading of a
// prospectus, a proxy or an 8-K narrative — is not shipped here. What is
// shipped is everything that reading is written against: the structured halves
// it runs beside, the tables it writes, the deterministic readings it is
// scored against, and the CLI helpers its commands are built from.
//
// `processFormS1Structured` / `processForm424Structured` are the readings this
// package DOES ship for a registration statement and a prospectus — the tagged
// facts, the issuer, the header SIC — under ids of their own (`S-1-xbrl`,
// `424-xbrl`). A consumer registering the prose half runs beside them, not
// instead of them, and its own tests drive both to reproduce a real dispatch.
export { processForm424Structured } from "./sec/forms/registration-statements/Form_424.storage";
export { processFormS1Structured } from "./sec/forms/registration-statements/Form_S_1.storage";
export { extractAndStoreXbrl } from "./sec/forms/registration-statements/s1/xbrlEnrichment";
export { XbrlFactRepo } from "./storage/xbrl/XbrlFactRepo";

// The 8-K's ITEM CODES, which stay here under the id `8-K-items`: the codes
// arrive in the submissions payload and in the XML envelope, so recording one
// row apiece takes no exhibit, no narrative and no model. Reading those same
// codes as de-SPAC milestones is not metadata — the mapper scans the filing's
// prose for the new registrant name behind a 5.03 and for the operating
// counterparty behind a merger 1.01, and reads the exhibit manifest to tell a
// definitive agreement from an ordinary one — so it is registered elsewhere,
// under `8-K`, and runs beside this over the same filing.
export { Form_8_K } from "./sec/forms/miscellaneous-filings/Form_8_K";
export { processForm8K } from "./sec/forms/miscellaneous-filings/Form_8_K.storage";
export { hasLoiTriggerItem } from "./sec/forms/miscellaneous-filings/spac8kLoiTriggers";
export { hasRedemptionTriggerItem } from "./sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
export { Form_DEFM14A } from "./sec/forms/proxies-information-statements/Form_DEFM14A";

// The prospectus cover and the two combination-listing checks: deterministic
// readings a SPAC's lifecycle bookkeeping depends on. The cover carries the
// headline offering size when the section an extractor was handed does not,
// and both listing checks answer from the `filings` table alone — no text scan,
// which is why they stay. `issuerHasCombinationListing` asks whether this CIK
// has ever both combined and listed; `isFirst20FAfterCombination` names the one
// 20-F that closes an FPI shell's registration when it files no 25-NSE, and
// answering it needs every 20-F this CIK filed, not just the one in hand.
export { splitDocumentSections } from "./sec/document/documentSections";
export {
  looksLikePricedIpoProspectusBody,
  parsePricedProspectusCover,
} from "./sec/forms/registration-statements/pricedProspectusCover";
export {
  isFirst20FAfterCombination,
  issuerHasCombinationListing,
} from "./sec/forms/registration-statements/s1/newcoListing";
export { RISK_FACTOR_CHUNK_CHARS } from "./sec/forms/registration-statements/s1/riskFactorChunks";
export { sectionHash } from "./verify/callTrace";

// The tables a prose extractor writes and this package still reads.
export { BeneficialOwnershipRepo } from "./storage/beneficial-ownership/BeneficialOwnershipRepo";
export { ExecutiveCompensationRepo } from "./storage/executive-compensation/ExecutiveCompensationRepo";
export { RelatedPartyTransactionRepo } from "./storage/related-party/RelatedPartyTransactionRepo";
export { RelatedPartyTransactionSchema } from "./storage/related-party/RelatedPartyTransactionSchema";
export { Section16Repo } from "./storage/section16/Section16Repo";

// Which filings a backfill of a given extractor should re-select, and the CLI
// option helpers a command group is built from — an option that answers with
// the values it accepts rather than exiting on a bare "argument missing".
export { csvOptionValue, optionValue } from "./cli/optionValue";
export { KNOWN_MODEL_ID_SHAPES, modelApiKeyEnvVar } from "./config/registerModels";
export { getBackfillDescriptor } from "./task/forms/backfillDescriptors";

// Running a backfill and naming what may be backfilled.
// `listBackfillableExtractorIds` is the LIVE vocabulary — the open form-extractor
// registry, the contributed descriptors, and the ids this package holds state
// for — read per call rather than snapshotted, because the registry is filled by
// the runtime bootstrap and by whichever package ships the readings. Any command
// validating an extractor argument checks against it, or two commands end up
// with two vocabularies and one of them refuses ids the other accepts.
// `ExtractorId` is deliberately open for the same reason: a closed union could
// not name an extractor registered through that seam.
export { listBackfillableExtractorIds } from "./task/forms/backfillDescriptors";
export {
  BackfillExtractorTask,
  type ExtractorBackfillResult,
} from "./task/forms/BackfillExtractorTask";

// The keyset resume a contributed descriptor selects candidates with. Shared
// rather than copied: a two-query walk that has to page past one filer holding
// more filings than the page size is not a thing to reimplement per package.
export type { ExtractorId } from "./storage/versioning/extractorIds";
export { pageFilingsOfForm, type FilingPageRow } from "./task/forms/backfillDescriptors";

// Putting one filing's document on disk the way the sweeps already do.
// `submissionFetchKind` is the single rule for WHICH file a form is fetched as —
// the full-submission `.txt` or the primary document — so a downloader outside
// this package writes the same bytes under the same name an offline pass here
// later looks for. `SecFetchAccessionDocTask` is the fetch itself, metered by
// the shared EDGAR queue, and `FORMS_SWEEP_CONCURRENCY_LIMIT` is the in-flight
// bound the forms sweeps run at — a second downloader picking its own would
// widen the peak the descriptor table has to survive. `sanitizePrimaryDoc` and
// `assertInsideDir` are what keep an EDGAR-supplied filename from escaping the
// cache directory, `tmpPathFor` names the sibling temp file an atomic write
// renames from, and `describeFailureReason` bounds an error into the single
// line a per-filing failure is recorded as.
export { FORMS_SWEEP_CONCURRENCY_LIMIT } from "./task/forms/formsSweep";
export { SecFetchAccessionDocTask } from "./task/forms/SecFetchAccessionDocTask";
export { submissionFetchKind, type SubmissionFetchKind } from "./task/forms/submissionFetchPolicy";
export { assertInsideDir, sanitizePrimaryDoc } from "./util/accessionDocPath";
export { tmpPathFor } from "./util/atomicFileWrite";
export { describeFailureReason } from "./util/describeFailure";

// The seam a package that ships a reading this one does not contributes its
// backfill through, plus the descriptor shape and the two pieces a contributed
// descriptor is built from: the forms its own registration routed here, and the
// default needing-work anti-join a descriptor widens rather than restates.
// Without a contributed descriptor the id resolves to no wiring and
// `sec extractor backfill` refuses it, which is the answer a deployment without
// that package should get.
export {
  clearRegisteredBackfillDescriptorsForTesting,
  defaultFilterTodo,
  formsForExtractor,
  registerBackfillDescriptor,
  type BackfillCandidate,
  type BackfillDescriptor,
} from "./task/forms/backfillDescriptors";

// The seam a package that owns the filer set contributes the documents sweep's
// 8-K gate through. The forms are this package's call; whose 8-Ks are worth a
// corpus of markdown is not, and with no gate registered the sweep converts
// none of them — the cheap answer, not the expensive one.
// The reader and the testing reset ride along with the registration: the gate
// is one module-level slot, so a package contributing one is also the package
// that has to prove its registration reached the seam and that the sweep still
// behaves with none — neither of which can be asked from outside without them.
export {
  clearFilingConversionGateForTesting,
  filingConversionGate,
  registerFilingConversionGate,
  type FilingConversionGate,
  type GateSqlFragment,
  type GateSqlPushdown,
  type GateSqlRequest,
} from "./task/document/filingConversionGate";
// The selector the gate is applied by, so the package contributing a gate can
// drive the sweep's own selection with it rather than asserting only about the
// gate object — which filings a rule selects is the thing that matters, and it
// is one query away from the rule.
export { FILING_DOCUMENT_REPOSITORY_TOKEN } from "./storage/document/FilingDocumentSchema";
export {
  CONVERTIBLE_FORMS,
  SPAC_GATED_FORMS,
  selectFilingsToConvert,
  type FilingToConvert,
  type SelectFilingsOptions,
} from "./task/document/selectFilingsToConvert";

// The seam a package that owns a lifecycle model contributes its reading of a
// filer's company facts through. The facts sweep reaches for it and does
// nothing where none is contributed — the point being that it does not call and
// swallow a failure per issuer, it does not call.
// `currentTrustRefresh` and the testing reset ride along with the registration:
// the sweep here is not the only caller that has to behave when nothing was
// contributed, and the package that contributes one still asks the registry
// rather than its own implementation — so the two callers ask the same
// question, and the "nothing registered" branch stays reachable and testable
// from the side that owns the reading.
export {
  COMPANY_FACTS_REPOSITORY_TOKEN,
  type CompanyFact,
} from "./storage/facts/CompanyFactsSchema";
export {
  clearCurrentTrustRefreshForTesting,
  currentTrustRefresh,
  registerCurrentTrustRefresh,
  type CurrentTrustRefresh,
} from "./task/facts/currentTrustRefresh";

// The seam the same package contributes the WRITE half of an editorial CSV
// through. The CSV's shape, its validation and its line-numbered errors are
// this package's; the rows it names are a lifecycle model's. With nothing
// registered, `editorial import` refuses a file of that shape by name rather
// than reporting rows it stored nowhere.
export {
  normalizeFamilyNameForKind,
  parseEditorialCsv,
  registerFamilyEditorialImporter,
  registerSpacEditorialImporter,
  type FamilyDescriptionRow,
  type FamilyEditorialImporter,
  type ImportSpacEditorialResult,
  type ParsedEditorialCsv,
  type SpacEditorialImporter,
  type SpacEditorialRow,
} from "./commands/editorialImport";

// The dispatcher itself. A package that registers a form extractor drives one
// stored filing through this to see what its own registration actually does —
// which file is fetched, what the `store` is handed, and what lands in
// `extractor_runs` and the dead letters — rather than calling its handler
// directly and taking the wiring on trust.
export { ProcessAccessionDocFormTask } from "./task/forms/ProcessAccessionDocFormTask";

// What a registration-withdrawal reading is written against: a SELECTION
// predicate over rows this package holds — the filings around an accession —
// so the handler that writes the event reads it from here rather than keeping a
// second copy of the question.
export { staffActionAbandonsRegistration } from "./sec/forms/registration-withdrawal-termination/staffActionAbandonsRegistration";

// The forms this package PARSES and declares are read elsewhere, keyed by the
// id the reading is recorded under. It is already the pinned answer to "which
// forms carry a reading this deployment may not have" — `form-wiring.test.ts`
// asserts it in both directions — so the package that supplies one of those
// readings registers over exactly this set rather than keeping a second copy
// that can drift a form at a time.
export {
  PARSER_ONLY_FORMS_BY_EXTRACTOR,
  parserOnlyExtractorIdForForm,
} from "./sec/forms/parserOnlyForms";
export { EntityRepo } from "./storage/entity/EntityRepo";

// Human-verified truth for the committed prospectus corpus. Read here by the
// chunker's own test, which is why it stays; anything scoring an extraction
// against it reads the same table rather than a copy that can drift.
export {
  GOLDEN_S1_LABELS,
  extractorsWithGoldenLabels,
  getGoldenFieldRows,
  getGoldenLabels,
  goldenLabelKey,
  isGoldenManagementRow,
  type GoldenFieldRow,
  type GoldenManagementRow,
  type GoldenOwnerRow,
  type GoldenPartyRow,
  type GoldenRow,
} from "./eval/goldenS1Labels";

// ── The `workglow` surface an out-of-package extraction tier runs on ─────────
// Re-exported rather than depended on directly, for the reason the block near
// the top of this file gives: a consumer importing its own `workglow` gets a
// different `globalServiceRegistry` and a different TypeBox, so its DI
// registrations and schemas would be invisible here. The AI half of this
// pipeline reaches for far more of that surface than the CLI half does — a
// provider registry to install a double into, the structured-generation task
// every extraction call runs through, the model repository and download tasks,
// and the usage/cost types a run is priced with — so it is named here rather
// than reached around.
export {
  AiProvider,
  AiProviderRegistry,
  MODEL_EFFORTS,
  ModelDownloadRemoveTask,
  ModelDownloadTask,
  ModelInfoTask,
  StructuredGenerationTask,
  StructuredOutputValidationError,
  TaskAbortedError,
  estimateCost,
  getAiProviderRegistry,
  getGlobalModelRepository,
  isModelEffort,
  mergeUsage,
  renderMarkdown,
  setAiProviderRegistry,
} from "workglow";
export type {
  AiProviderRunFn,
  AiProviderRunFnRegistration,
  Capability,
  DataPortSchema,
  ModelConfig,
  ModelEffort,
  Usage,
} from "workglow";
export type { Form8K } from "./sec/forms/miscellaneous-filings/Form_8_K.schema";
