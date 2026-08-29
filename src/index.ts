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
  expandFormTypes,
  formsForExtractorIds,
  SYNC_FORM_DOMAINS,
} from "./cli/sync/syncFormDomains";
export {
  clearSyncLeavesForTesting,
  EMPTY_SYNC_CONTEXT,
  getSyncLeaf,
  listSyncLeaves,
  registerSyncLeaf,
  runSyncLeaves,
  type SyncLeaf,
  type SyncRunContext,
  type SyncStep,
} from "./cli/sync/syncLeaves";

// ── Config / dependency injection ───────────────────────────────────────────
export * from "./config/Constants";
export { createStorage } from "./config/createStorage";
export { DefaultDI } from "./config/DefaultDI";
export {
  defineStorage,
  registerStorages,
  type StorageDefinition,
  type StorageFactory,
} from "./config/storageRegistry";
export { EnvToDI, SecCliConfigurationError } from "./config/EnvToDI";
export { bootstrapSecRuntime } from "./config/bootstrapSecRuntime";
export { registerSecModels } from "./config/registerModels";
export { registerSecProviders } from "./config/registerProviders";
export { registerSecTasks } from "./config/registerTasks";
export { setupAllDatabases } from "./config/setupAllDatabases";
export * from "./config/tokens";

// ── Fetch job queue + fetch task bases ──────────────────────────────────────
export {
  SecCachedFetchTask,
  type response_type,
  type SecCachedFetchTaskInput,
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
  getTaskQueueRegistry,
  globalServiceRegistry,
  registerSafeFetch,
  Sqlite,
  Task,
  Workflow,
} from "workglow";
export type {
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  IExecuteContext,
  SafeFetchFn,
  ServiceToken,
  TaskOutput,
} from "workglow";
export type { TaskPorts } from "./task/taskPorts";
export { isStaleByAsOf } from "./util/asOfGuard";

// ── Extension seams for downstream feature packages ─────────────────────────
// A downstream feature package (e.g. `embarc-data`) registers its own resolver
// ids and DB-extension repo tokens through these seams, then reuses the
// versioning / observation / normalization internals below.
export {
  listDatabaseExtensionTokens,
  registerDatabaseExtension,
  registerDatabaseSetupHook,
} from "./config/databaseExtensions";
export {
  getResolverExtension,
  isFamilyResolverId,
  listResolverIds,
  registerResolverExtension,
  type ResolverExtension,
} from "./resolver/resolverExtensions";
export {
  extractorKey,
  allRegisteredExtractorIds,
  allRegisteredForms,
  extractorIdsForForm,
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
export { registerSecFormExtractors } from "./config/registerFormExtractors";
export { selectRegAReportDocument } from "./sec/forms/exempt-offerings/regAReportDocument";
export { parseNumeric } from "./sec/html/parseNumeric";
export { ExtractorRunRepo } from "./storage/versioning/ExtractorRunRepo";
// `GATE_VERDICTS` and `isGateDecline` travel with the repo because the handlers
// that KNOW a gate declined are registered from outside this package while the
// table stays here: a downstream `store` reports a verdict from this vocabulary
// and the dispatcher records it, so both halves read the same one.
export {
  EXTRACTOR_RUN_REPOSITORY_TOKEN,
  GATE_VERDICTS,
  isGateDecline,
  type ExtractorGateVerdict,
} from "./storage/versioning/ExtractorRunSchema";
export { ExtractionDeadLetterRepo } from "./storage/dead-letter/ExtractionDeadLetterRepo";

// ── EDGAR HTML parser + section vocabulary ──────────────────────────────────
// The form-agnostic HTML → Document pass, plus what a consumer needs to work
// with what it returns: the block list and its `[start, end)` spans back into
// the filing HTML, the drop report, and the heading vocabulary the parser and
// the form segmenters share. Pure and synchronous — nothing here reads DI, the
// database, or a model.
export {
  parseEdgarHtml,
  parseEdgarHtmlWithTrace,
  type EdgarParseTrace,
} from "./sec/html/parseEdgarHtml";
export type { EdgarBlock, SourceSpan } from "./sec/html/types";
export type { DroppedBlock } from "./sec/html/DePaginator";
export { subtreeSourceSpan, type SourceSpanIndex } from "./sec/html/sourceSpanIndex";
export { isHidden, stripNonProse } from "./sec/html/domPrep";
export {
  S1_SECTIONS,
  SECTION_HEADING_PATTERNS,
  type S1SectionName,
} from "./sec/html/sectionVocabulary";

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
export { DocumentTreeSegmenter } from "./sec/forms/registration-statements/s1/DocumentTreeSegmenter";
export type {
  DocumentSegmenter,
  Section,
} from "./sec/forms/registration-statements/s1/DocumentSegmenter";

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
// `buildEntityObserver` wires an `EntityObserver` out of DI at the given
// active resolver versions, so a form module does not repeat the ceremony and
// cannot resolve against a stale version by accident.
// `COMPLETE_ROSTER_ROLE_SCOPES` names the scopes whose filings list everyone
// holding the role, and so the only ones where a later filing's silence may
// end a tenure. It is shared rather than restated because a roster closure
// pass and anything recomputing tenures from stored evidence must agree on the
// set exactly.
export { buildEntityObserver } from "./resolver/buildEntityObserver";
export { EntityObserver } from "./resolver/EntityObserver";
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
export { isOverlongPersonName, MAX_PERSON_NAME_CHARS } from "./util/personNameBounds";

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
export { FamilyResolver, normalizeFamilyName } from "./resolver/FamilyResolver";
export {
  CanonicalFamilyAliasRepo,
  type FamilyAliasRow,
} from "./storage/canonical/CanonicalFamilyAliasRepo";

// ── Versioning internals ────────────────────────────────────────────────────
export { computeResolverCoverage } from "./cli/queries/ResolverCoverage";
export { COMPONENT_VERSION_REPOSITORY_TOKEN } from "./storage/versioning/ComponentVersionSchema";
export { getActiveSlot } from "./storage/versioning/getActiveSlot";
export { VersionRegistry } from "./storage/versioning/VersionRegistry";

// ── Observation + filing repos / tokens ─────────────────────────────────────
export { FILING_REPOSITORY_TOKEN } from "./storage/filing/FilingSchema";
export { CompanyObservationRepo } from "./storage/observation/CompanyObservationRepo";
export { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "./storage/observation/CompanyObservationSchema";
export { PersonObservationRepo } from "./storage/observation/PersonObservationRepo";
export { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "./storage/observation/PersonObservationSchema";
export { PersonObservationTitleRepo } from "./storage/observation/PersonObservationTitleRepo";
export {
  PERSON_OBSERVATION_TITLE_REPOSITORY_TOKEN,
  type PersonObservationTitle,
} from "./storage/observation/PersonObservationTitleSchema";

// ── Canonical person identity tier (observation → canonical id, merge aliases)
// The join a downstream superset needs to get from a person observation to the
// canonical id `person_role` and the junction tables are keyed by: the identity
// link resolves it at a given `resolver_version`, and the alias table redirects
// an id that a later merge retired.
export {
  CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
  type CanonicalPersonAlias,
} from "./storage/canonical/CanonicalAliasSchemas";
export { CanonicalPersonAliasRepo } from "./storage/canonical/CanonicalPersonAliasRepo";
export { PersonIdentityLinkRepo } from "./storage/canonical/PersonIdentityLinkRepo";
export {
  PERSON_IDENTITY_LINK_REPOSITORY_TOKEN,
  type PersonIdentityLink,
} from "./storage/canonical/PersonIdentityLinkSchema";

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
export { cleanListedTickers, normalizeListedTicker } from "./util/listedTicker";
export { KeyedMutex } from "./util/KeyedMutex";
export { parseCikSafely as parseCik } from "./util/parseCik";
export { TypeNullable } from "./util/TypeBoxUtil";

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
export {
  GENERAL_DEFINITIVE_PROXY_FORMS,
  MERGER_PROXY_OPTIONAL_FORMS,
  MERGER_PROXY_SECTION,
  SECTIONLESS_REGISTRATION_FORMS,
} from "./storage/versioning/extractorIds";
export { cachedAccessionDocPath, resolvePrimaryDocName } from "./util/accessionDocPath";
export { listPricingForModelId } from "./config/listPricing";
export { registerModelIds, trySecModelRecord } from "./config/registerModels";
export { resolveAsset } from "./util/resolveAsset";
export { extractPrimaryDocFromSubmission } from "./task/bootstrap/feedTarball";
export { seeksCombinationApproval } from "./sec/forms/proxies-information-statements/seeksCombinationApproval";
export {
  chunkRiskFactorText,
  isRiskCategoryHeading,
  MAX_RISK_FACTORS_CHARS,
  stripHeadingMarkers,
} from "./sec/forms/registration-statements/s1/riskFactorChunks";
export { foldTypographicPunctuation } from "./util/dataCleaningUtils";
export { normalizeCompany } from "./storage/company/CompanyNormalization";
export { normalizePerson } from "./storage/person/PersonNormalization";
export type { Filing } from "./storage/filing/FilingSchema";
export { S1ClassificationRepo } from "./storage/classification/S1ClassificationRepo";
export { ObservationProvenanceRepo } from "./storage/provenance/ObservationProvenanceRepo";
export { IssuerTickerRepo } from "./storage/offering/IssuerTickerRepo";
export { OfferingTermsRepo } from "./storage/offering/OfferingTermsRepo";
export { SpacPromoteTermsRepo } from "./storage/offering/SpacPromoteTermsRepo";
export { SpacUnitTermsRepo } from "./storage/offering/SpacUnitTermsRepo";

// ── Scaffolding: expected to be withdrawn, do not build on ──────────────────
// NOT stable API. The extraction work these belong to is being relocated to a
// downstream package one tier at a time, and a tier that has already left has
// to keep reaching back for the tiers that have not. These exports exist only
// so that reaching back is an import rather than a reimplementation, and they
// go away — without deprecation — as soon as the tier behind each one follows
// it out of this package. Anything outside that migration should treat them as
// private and use the surfaces above instead.
//
// The SPAC lifecycle tier (the `spac` row, its event/report writer, and the
// per-form LOI / merger / redemption extraction rows) and the canonical family
// tier (sponsor and underwriter family resolution, membership and links) are
// the two still here. `normalizeManagementTitles` is the third: the title
// canonicalization stays only while this package's inline observe path calls
// it.
export { SpacRepo } from "./storage/spac/SpacRepo";
export { SpacReportWriter, type ProxyEventVerdict } from "./storage/spac/SpacReportWriter";
export { SpacLoiExtractionRepo } from "./storage/spac/SpacLoiExtractionRepo";
export { SpacMergerExtractionRepo } from "./storage/spac/SpacMergerExtractionRepo";
export { SpacRedemptionExtractionRepo } from "./storage/spac/SpacRedemptionExtractionRepo";
export { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "./storage/spac/SpacCandidateSchema";
export type { SpacEvent, SpacEventType } from "./storage/spac/SpacEventSchema";
export { pendingDealBefore } from "./storage/spac/spacDealGrouping";
export { isNewerTrustSnapshot } from "./storage/spac/trustSnapshot";
export { SponsorFamilyResolver } from "./resolver/SponsorFamilyResolver";
export { UnderwriterFamilyResolver } from "./resolver/UnderwriterFamilyResolver";
export { CanonicalSponsorFamilyAliasRepo } from "./storage/canonical/CanonicalSponsorFamilyAliasRepo";
export { CanonicalSponsorFamilyRepo } from "./storage/canonical/CanonicalSponsorFamilyRepo";
export { SpacSponsorLinkRepo } from "./storage/canonical/SpacSponsorLinkRepo";
export { SponsorFamilyMembershipRepo } from "./storage/canonical/SponsorFamilyMembershipRepo";
export { CanonicalUnderwriterFamilyAliasRepo } from "./storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
export { CanonicalUnderwriterFamilyRepo } from "./storage/canonical/CanonicalUnderwriterFamilyRepo";
export { UnderwriterFamilyMembershipRepo } from "./storage/canonical/UnderwriterFamilyMembershipRepo";
export { UnderwriterLinkRepo } from "./storage/canonical/UnderwriterLinkRepo";
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
export { processFormS1Structured } from "./sec/forms/registration-statements/Form_S_1.storage";
export { processForm424Structured } from "./sec/forms/registration-statements/Form_424.storage";
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
export { processForm8K } from "./sec/forms/miscellaneous-filings/Form_8_K.storage";
export { Form_8_K } from "./sec/forms/miscellaneous-filings/Form_8_K";
export { hasLoiTriggerItem } from "./sec/forms/miscellaneous-filings/spac8kLoiTriggers";
export { hasRedemptionTriggerItem } from "./sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
export { Form_DEFM14A } from "./sec/forms/proxies-information-statements/Form_DEFM14A";

// The prospectus cover and the combination-listing check: two deterministic
// readings a SPAC's lifecycle bookkeeping depends on. The cover carries the
// headline offering size when the section an extractor was handed does not,
// and `issuerHasCombinationListing` answers from the `filings` table alone —
// no text scan, which is why both stay.
export {
  looksLikePricedIpoProspectusBody,
  parsePricedProspectusCover,
} from "./sec/forms/registration-statements/pricedProspectusCover";
export { issuerHasCombinationListing } from "./sec/forms/registration-statements/s1/newcoListing";
export { RISK_FACTOR_CHUNK_CHARS } from "./sec/forms/registration-statements/s1/riskFactorChunks";
export { splitDocumentSections } from "./sec/document/documentSections";
export { sectionHash } from "./verify/callTrace";

// The tables a prose extractor writes and this package still reads.
export { BeneficialOwnershipRepo } from "./storage/beneficial-ownership/BeneficialOwnershipRepo";
export { CompanyIdentityLinkRepo } from "./storage/canonical/CompanyIdentityLinkRepo";
export { ExecutiveCompensationRepo } from "./storage/executive-compensation/ExecutiveCompensationRepo";
export { RelatedPartyTransactionRepo } from "./storage/related-party/RelatedPartyTransactionRepo";
export { RelatedPartyTransactionSchema } from "./storage/related-party/RelatedPartyTransactionSchema";
export { Section16Repo } from "./storage/section16/Section16Repo";
export type { SpacStatus } from "./storage/spac/SpacSchema";

// Family-name normalization, so a sponsor or underwriter observed outside this
// package folds to the same family key one observed inside it does.
export { normalizeSponsorFamilyName } from "./resolver/SponsorFamilyResolver";
export { normalizeUnderwriterFamilyName } from "./resolver/UnderwriterFamilyResolver";

// Which filings a backfill of a given extractor should re-select, and the CLI
// option helpers a command group is built from — an option that answers with
// the values it accepts rather than exiting on a bare "argument missing".
export { getBackfillDescriptor } from "./task/forms/backfillDescriptors";
export { csvOptionValue, optionValue } from "./cli/optionValue";
export { KNOWN_MODEL_ID_SHAPES, modelApiKeyEnvVar } from "./config/registerModels";

// The seam a package that ships a reading this one does not contributes its
// backfill through, plus the descriptor shape and the ready-made factory for a
// known-SPAC 8-K narrative pass. Without a contributed descriptor the id
// resolves to no wiring and `sec extractor backfill` refuses it, which is the
// answer a deployment without that package should get.
export {
  registerBackfillDescriptor,
  spacTrigger8KDescriptor,
  type BackfillCandidate,
  type BackfillDescriptor,
} from "./task/forms/backfillDescriptors";

// The seam a package that owns the filer set contributes the documents sweep's
// 8-K gate through. The forms are this package's call; whose 8-Ks are worth a
// corpus of markdown is not, and with no gate registered the sweep converts
// none of them — the cheap answer, not the expensive one.
export {
  registerFilingConversionGate,
  type FilingConversionGate,
  type GateSqlFragment,
  type GateSqlPushdown,
  type GateSqlRequest,
} from "./task/document/filingConversionGate";

// The seam a package that owns a SPAC lifecycle model contributes its reading
// of a filer's company facts through. The facts sweep and `spac backfill-trust`
// reach for it and do nothing where none is contributed — the point being that
// they do not call and swallow a failure per issuer, they do not call.
export {
  registerCurrentTrustRefresh,
  type CurrentTrustRefresh,
} from "./storage/spac/currentTrustRefresh";
export {
  COMPANY_FACTS_REPOSITORY_TOKEN,
  type CompanyFact,
} from "./storage/facts/CompanyFactsSchema";

// The dispatcher itself. A package that registers a form extractor drives one
// stored filing through this to see what its own registration actually does —
// which file is fetched, what the `store` is handed, and what lands in
// `extractor_runs` and the dead letters — rather than calling its handler
// directly and taking the wiring on trust.
export { ProcessAccessionDocFormTask } from "./task/forms/ProcessAccessionDocFormTask";

// What a listing-removal or registration-withdrawal reading is written
// against. Both are SELECTION predicates over rows this package holds — the
// filings around an accession, the events dated before it — and they are what
// `sec spac process` and `sec extractor backfill 25-15` / `RW` re-select on, so
// they stay here and the handler that writes the event reads them from here.
export {
  listingRemovalNeedsWork,
  resolveListingRemovalKind,
} from "./sec/forms/exchange-listing-withdrawal/listingRemovalSelection";
export { staffActionAbandonsRegistration } from "./sec/forms/registration-withdrawal-termination/staffActionAbandonsRegistration";
export { EntityRepo } from "./storage/entity/EntityRepo";

// Human-verified truth for the committed prospectus corpus. Read here by the
// chunker's own test, which is why it stays; anything scoring an extraction
// against it reads the same table rather than a copy that can drift.
export {
  extractorsWithGoldenLabels,
  getGoldenFieldRows,
  getGoldenLabels,
  goldenLabelKey,
  isGoldenManagementRow,
  GOLDEN_S1_LABELS,
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
