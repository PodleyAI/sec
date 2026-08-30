/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { expect, test } from "vitest";
import * as sec from "./index";

test("barrel exposes the sec dependencies a downstream feature package builds on", () => {
  for (const name of [
    "createStorage",
    "registerResolverExtension",
    "getResolverExtension",
    "listResolverIds",
    "isFamilyResolverId",
    "registerDatabaseExtension",
    "registerFilingConversionGate",
    "registerCurrentTrustRefresh",
    "listDatabaseExtensionTokens",
    "VersionRegistry",
    "computeResolverCoverage",
    "computeResolverCoverage",
    "getActiveSlot",
    "COMPONENT_VERSION_REPOSITORY_TOKEN",
    "PersonObservationRepo",
    "CompanyObservationRepo",
    "PERSON_OBSERVATION_REPOSITORY_TOKEN",
    "COMPANY_OBSERVATION_REPOSITORY_TOKEN",
    "FILING_REPOSITORY_TOKEN",
    "normalizeCompanyName",
    "generateCompanyHash",
    "hasCompanyEnding",
    "normalizeAddress",
    "normalizePhone",
    "isBadPersonField",
    "TypeSecCik",
    "TypeNullable",
    "streamMatchingRows",
    "KeyedMutex",
    "parseCik",
    "createServiceToken",
    "InMemoryTabularStorage",
    "setupAllDatabases",
    "registerDatabaseSetupHook",
    "resetDependencyInjectionsForTesting",
    "globalServiceRegistry",
    "Type",
    "Sqlite",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});

test("exports task + temporal primitives downstream ingestion needs", () => {
  expect(typeof (sec as Record<string, unknown>).Task).toBe("function");
  expect(typeof (sec as Record<string, unknown>).Workflow).toBe("function");
  expect(typeof (sec as Record<string, unknown>).isStaleByAsOf).toBe("function");
  // A superset stubs SafeFetch through the barrel so it hits sec's workglow
  // singleton, not a second copy of `registerSafeFetch`.
  expect(typeof (sec as Record<string, unknown>).registerSafeFetch).toBe("function");
});

test("exports family-tier primitives for a downstream family resolver", () => {
  const b = sec as Record<string, unknown>;
  expect(typeof b.FamilyResolver).toBe("function");
  expect(typeof b.normalizeFamilyName).toBe("function");
  expect(typeof b.CanonicalFamilyAliasRepo).toBe("function");
});

test("exports the person identity tier a downstream role query joins through", () => {
  const b = sec as Record<string, unknown>;
  expect(typeof b.PersonIdentityLinkRepo).toBe("function");
  expect(typeof b.CanonicalPersonAliasRepo).toBe("function");
  expect(typeof b.PersonRoleRepo).toBe("function");
  for (const name of [
    "PERSON_IDENTITY_LINK_REPOSITORY_TOKEN",
    "CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN",
    "PERSON_ROLE_REPOSITORY_TOKEN",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});

test("exports the EDGAR HTML parser surface", () => {
  for (const name of [
    "parseEdgarHtml",
    "parseEdgarHtmlWithTrace",
    "subtreeSourceSpan",
    "isHidden",
    "stripNonProse",
    "parseNumeric",
    "S1_SECTIONS",
    "SECTION_HEADING_PATTERNS",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }

  // The types this surface hands back are erased before this file runs, so no
  // expectation can reach them. They are pinned instead by annotating the real
  // values below with them: an annotation whose type the barrel stopped
  // exporting fails `tsc -p tsconfig.test.json` naming that type. The values
  // are the ones a downstream segmenter actually holds, so the annotations are
  // load-bearing rather than a restatement of the export list.
  const trace: sec.EdgarParseTrace = sec.parseEdgarHtmlWithTrace(
    "<p style='font-weight:700'>Risk Factors</p><p>The offering may not close.</p>",
    "S-1"
  );
  const blocks: readonly sec.EdgarBlock[] = trace.blocks;
  const dropped: readonly sec.DroppedBlock[] = trace.dropped;
  const index: sec.SourceSpanIndex = trace.sourceByNodeId;
  const span: sec.SourceSpan | undefined = sec.subtreeSourceSpan(trace.doc, index);
  const section: sec.S1SectionName = sec.S1_SECTIONS.RISK_FACTORS;

  expect(blocks.length).toBeGreaterThan(0);
  expect(Array.isArray(dropped)).toBe(true);
  expect(span?.end).toBeGreaterThan(0);
  expect(sec.SECTION_HEADING_PATTERNS[section].length).toBeGreaterThan(0);
  expect(sec.parseEdgarHtml("<p>x</p>", "S-1").title).toBe("S-1");
});

test("exports the extraction seam an out-of-package form extractor is built on", () => {
  for (const name of [
    "parseRegistrationSubmission",
    "parseEightKSubmission",
    "DocumentTreeSegmenter",
    "getExtractionTemperature",
    "deterministicModelRecord",
    "buildObserveOnlyEntityObserver",
    "resolveObservationsForAccession",
    "ResolveObservationsTask",
    "buildEntityObserver",
    "EntityObserver",
    "COMPLETE_ROSTER_ROLE_SCOPES",
    "LOI_TRIGGER_ITEMS",
    "REDEMPTION_TRIGGER_ITEMS",
    "isCompanyFamilyPrefixEcho",
    "isUnnamedCompanyName",
    "splitParentClause",
    "parentClauseSourceContext",
    "assertWithinDeclaredBounds",
    "legalFormTrailingCanonical",
    "isOverlongPersonName",
    "isCallTracing",
    "recordCall",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});

/** A minimal full-submission `.txt`: SGML header, primary document, EX-99.1. */
const EIGHT_K_SUBMISSION = [
  "<SEC-HEADER>",
  "COMPANY CONFORMED NAME:			Acme Acquisition Corp",
  "CENTRAL INDEX KEY:			0001234567",
  "</SEC-HEADER>",
  "<DOCUMENT>",
  "<TYPE>8-K",
  "<SEQUENCE>1",
  "<TEXT>",
  "<p>Item 1.01 Entry into a Material Definitive Agreement.</p>",
  "</TEXT>",
  "</DOCUMENT>",
  "<DOCUMENT>",
  "<TYPE>EX-99.1",
  "<SEQUENCE>2",
  "<TEXT>",
  "<p>Acme signed a letter of intent with Target Holdings, LLC.</p>",
  "</TEXT>",
  "</DOCUMENT>",
].join("\n");

test("the extraction seam parses, segments and guards over a real submission", () => {
  // Same convention as the parser surface above: the types this seam hands
  // back and takes are erased before this file runs, so they are pinned by
  // annotating the values a downstream extractor actually holds. An annotation
  // whose type the barrel stopped exporting fails `tsc -p tsconfig.test.json`
  // naming that type.
  const parsed: sec.FormS1Parsed = sec.parseRegistrationSubmission("8-K", EIGHT_K_SUBMISSION);
  expect(parsed.header.cik).toBe(1234567);
  expect(parsed.html).toContain("Material Definitive Agreement");
  expect(parsed.xbrlInstanceXml).toBeNull();

  const eightK = sec.parseEightKSubmission("8-K", EIGHT_K_SUBMISSION);
  expect(eightK.exhibitsHtml).toHaveLength(1);
  expect(eightK.exhibitsHtml[0]).toContain("letter of intent");
  expect(sec.LOI_TRIGGER_ITEMS).toContain("1.01");
  expect(sec.REDEMPTION_TRIGGER_ITEMS).toContain("5.07");

  // The cutter and the interface it satisfies: a downstream extractor holds
  // the interface so it can be handed a different one.
  const segmenter: sec.DocumentSegmenter = new sec.DocumentTreeSegmenter();
  const trace = sec.parseEdgarHtmlWithTrace(
    "<h1>Risk Factors</h1><p>The offering may not close.</p>" +
      "<h1>Use of Proceeds</h1><p>We will use the net proceeds for working capital.</p>",
    "S-1"
  );
  const sections: readonly sec.Section[] = segmenter.segment(trace.doc);
  const riskFactors = sections.find((s) => s.name === sec.S1_SECTIONS.RISK_FACTORS);
  expect(riskFactors?.text).toContain("may not close");

  // Guards a persist path applies to what a model returned.
  expect(sec.isUnnamedCompanyName("the Company")).toBe(true);
  expect(sec.isOverlongPersonName("x".repeat(400))).toBe(true);
  expect(sec.isCompanyFamilyPrefixEcho("Acme", ["Acme Acquisition Corp"])).toBe(true);
  expect(sec.legalFormTrailingCanonical.some(([re]) => re.test("Target Holdings, LLC"))).toBe(true);
  const split = sec.splitParentClause(
    "Target Holdings, LLC, a subsidiary of Acme Acquisition Corp"
  );
  expect(split.observationName).toBe("Target Holdings, LLC");
  expect(split.familyName).toBe("Acme Acquisition Corp");
  expect(sec.parentClauseSourceContext("8-k:party", split)).toContain("Acme Acquisition Corp");
  expect(() =>
    sec.assertWithinDeclaredBounds(
      [{ period: "x".repeat(500) }],
      { properties: { period: { type: "string", maxLength: 64 } } },
      "related-party transaction"
    )
  ).toThrow();

  // Extraction-call configuration, and the vocabulary a failed section is
  // recorded under.
  expect(typeof sec.deterministicModelRecord().model_id).toBe("string");
  const temperature: number | undefined = sec.getExtractionTemperature();
  expect(temperature === undefined || Number.isFinite(temperature)).toBe(true);
  const failure: { readonly section_name: string; readonly reason_code: sec.DeadLetterReasonCode } =
    { section_name: "risk-factors", reason_code: "MODEL_INVALID_OUTPUT" };
  expect(failure.reason_code).toBe("MODEL_INVALID_OUTPUT");

  // Both builders need live DI, so what is pinned here is their signatures.
  // The observe-only one takes no versions at all — that is the point of it:
  // there is no resolver to point at a version, so there is no stale version
  // to point at by accident.
  const buildObserveOnly: () => sec.ObserveOnlyEntityObserver = sec.buildObserveOnlyEntityObserver;
  expect(typeof buildObserveOnly).toBe("function");
  const buildObserver: (args: {
    readonly activeResolverPersonVersion: string;
    readonly activeResolverCompanyVersion: string;
  }) => sec.EntityObserver = sec.buildEntityObserver;
  expect(typeof buildObserver).toBe("function");
  expect(sec.COMPLETE_ROSTER_ROLE_SCOPES.s1Management).toBe("s1:management");

  // Call tracing: off unless SEC_TRACE_DIR names a directory, so this asserts
  // the switch rather than writing a trace.
  expect(typeof sec.isCallTracing()).toBe("boolean");
  const attempt: sec.CallValidationAttempt = {
    attempt: 1,
    errors: [{ path: "/rows/0/full_name", message: "Expected string" }],
    object: { rows: [] },
  };
  const outcome: sec.CallOutcome = "invalid-output";
  expect(attempt.errors[0]?.path).toBe("/rows/0/full_name");
  expect(outcome).toBe("invalid-output");
});

test("exports the form vocabulary, corpus paths and bookkeeping an extractor reads", () => {
  for (const name of [
    "GENERAL_DEFINITIVE_PROXY_FORMS",
    "MERGER_PROXY_OPTIONAL_FORMS",
    "MERGER_PROXY_SECTION",
    "SECTIONLESS_REGISTRATION_FORMS",
    "cachedAccessionDocPath",
    "resolvePrimaryDocName",
    "listPricingForModelId",
    "registerModelIds",
    "trySecModelRecord",
    "resolveAsset",
    "extractPrimaryDocFromSubmission",
    "seeksCombinationApproval",
    "chunkRiskFactorText",
    "isRiskCategoryHeading",
    "MAX_RISK_FACTORS_CHARS",
    "stripHeadingMarkers",
    "foldTypographicPunctuation",
    "normalizeCompany",
    "normalizePerson",
    "S1ClassificationRepo",
    "ObservationProvenanceRepo",
    "IssuerTickerRepo",
    "OfferingTermsRepo",
    "SpacPromoteTermsRepo",
    "SpacUnitTermsRepo",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }

  // The form vocabulary the worklist selects by, so an out-of-package extractor
  // reads the same sets rather than restating them.
  expect(sec.GENERAL_DEFINITIVE_PROXY_FORMS.has("DEF 14A")).toBe(true);
  expect(sec.MERGER_PROXY_OPTIONAL_FORMS.has("DEF 14A")).toBe(true);
  expect(sec.MERGER_PROXY_SECTION).toBe("merger");
  expect(sec.SECTIONLESS_REGISTRATION_FORMS.has("S-1MEF")).toBe(true);

  // A filing row is what an out-of-package sweep iterates, and these two are how
  // it gets from that row to the document a sweep already downloaded — the xsl
  // viewer prefix stripped, the name refused if it could escape the cache
  // directory. `Filing` is erased before this file runs, so it is pinned by
  // annotating the function that does the walk: an annotation whose type the
  // barrel stopped exporting fails `tsc -p tsconfig.test.json` naming it.
  const cachedDocPath: (
    filing: Pick<sec.Filing, "cik" | "accession_number" | "primary_doc">,
    root: string
  ) => string | undefined = (filing, root) => {
    const name = sec.resolvePrimaryDocName(filing.primary_doc);
    return name === undefined
      ? undefined
      : sec.cachedAccessionDocPath(root, filing.cik, filing.accession_number, name);
  };
  const filing = {
    cik: 1234567,
    accession_number: "0001234567-24-000001",
    primary_doc: "xslF345X03/d8k.htm",
  };
  expect(cachedDocPath(filing, "/raw")).toBe(
    "/raw/accessiondocs/0001234567/000123456724000001-d8k.htm"
  );
  expect(cachedDocPath({ ...filing, primary_doc: null }, "/raw")).toBeUndefined();
  expect(cachedDocPath({ ...filing, primary_doc: "../escape.htm" }, "/raw")).toBeUndefined();

  // Model bookkeeping: an id nobody claims is inspected, not thrown on, and an
  // unpriced id reports cost as unavailable rather than guessing.
  expect(sec.trySecModelRecord("not-a-registered-model-id")).toBeUndefined();
  expect(sec.listPricingForModelId("not-a-registered-model-id")).toBeUndefined();

  // Risk-factor chunking, shared with this package's own span verifier so a
  // boundary an extractor produced and one the verifier expects agree.
  expect(sec.MAX_RISK_FACTORS_CHARS).toBeGreaterThan(0);
  expect(sec.stripHeadingMarkers("## Risks Relating to our Securities")).toBe(
    "Risks Relating to our Securities"
  );
  expect(sec.isRiskCategoryHeading("## Risks Relating to our Securities")).toBe(true);
  expect(sec.isRiskCategoryHeading("We may not complete our initial business combination.")).toBe(
    false
  );

  // The approval evidence a merger proxy needs beside an extracted deal.
  expect(
    sec.seeksCombinationApproval(
      "To approve the Agreement and Plan of Merger, dated as of June 1, 2024."
    )
  ).toBe(true);
  expect(sec.seeksCombinationApproval("To elect two directors to the board.")).toBe(false);

  // The fold a stored row is compared through, so a score computed outside this
  // package means what one computed inside it means.
  expect(sec.foldTypographicPunctuation("“Acme’s” — Corp")).toBe('"Acme\'s" - Corp');
});

// The scaffolding block covers groups that leave this package on different
// schedules — the sponsor/underwriter family tier, and the roster/backfill
// helpers that stay. One test over both would still be passing under a name
// that had stopped describing it as soon as the first group left, so each group
// is asserted on its own and the group's test goes with the group.
test("exports the sponsor and underwriter family tier a relocated resolver still links through", () => {
  for (const name of [
    "SponsorFamilyResolver",
    "UnderwriterFamilyResolver",
    "CanonicalSponsorFamilyAliasRepo",
    "CanonicalSponsorFamilyRepo",
    "SpacSponsorLinkRepo",
    "SponsorFamilyMembershipRepo",
    "CanonicalUnderwriterFamilyAliasRepo",
    "CanonicalUnderwriterFamilyRepo",
    "UnderwriterFamilyMembershipRepo",
    "UnderwriterLinkRepo",
  ]) {
    expect(typeof sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBe("function");
  }

  // Counting an issuer's links is a query on the storage rather than a repo
  // method, so the two link tokens are part of this tier's surface too.
  for (const name of ["SPAC_SPONSOR_LINK_REPOSITORY_TOKEN", "UNDERWRITER_LINK_REPOSITORY_TOKEN"]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
});

test("exports the roster titles and backfill descriptors a contributed extractor registers through", async () => {
  for (const name of [
    "normalizeManagementTitles",
    "registerBackfillDescriptor",
    "defaultFilterTodo",
    "formsForExtractor",
  ]) {
    expect(typeof sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBe("function");
  }

  // `BackfillDescriptor` is erased before this file runs, so it is pinned by
  // annotating what a contributing package actually holds: an id plus the
  // filings it should have read. A descriptor whose shape the barrel stopped
  // exporting fails `tsc -p tsconfig.test.json` naming it.
  const descriptor: sec.BackfillDescriptor = {
    extractorId: "redemption",
    selectCandidates: async () => [{ cik: 1, accession_number: "0000000001-26-000001" }],
  };
  const candidates: readonly sec.BackfillCandidate[] = await descriptor.selectCandidates();
  expect(candidates.map((c) => c.accession_number)).toEqual(["0000000001-26-000001"]);
  expect(descriptor.filterTodo).toBeUndefined();

  // The title canonicalization an extracted roster is stored through — the same
  // one this package's inline observe path applies, which is why it is shared.
  expect(sec.normalizeManagementTitles("Chief Executive Officer and Director")).toEqual([
    "Chief Executive Officer",
    "Director",
  ]);
});

test("exports the dispatcher, exhibit manifest and facts tier a relocated writer runs on", () => {
  // Form-agnostic machinery a relocated writer is built out of: the dispatcher
  // the whole thing runs under, the issuer repo it names a filer through, the
  // exhibit manifest and legal-form vocabulary a milestone is read with, and
  // the withdrawal predicate that answers from `filings` alone.
  for (const name of [
    "ProcessAccessionDocFormTask",
    "EntityRepo",
    "formatExhibitDetail",
    "parseSubmissionExhibits",
    "staffActionAbandonsRegistration",
  ]) {
    expect(typeof sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBe("function");
  }
  expect(
    sec.COMPANY_FACTS_REPOSITORY_TOKEN,
    "missing barrel export: COMPANY_FACTS_REPOSITORY_TOKEN"
  ).toBeDefined();
  expect(typeof sec.legalFormProseSuffixAlternation).toBe("string");

  // `CurrentTrustRefresh`, `CompanyFact` and `SubmissionExhibit` are erased
  // before this file runs, so they are pinned by annotating the values a
  // contributing package actually holds: the refresh it registers, the fact a
  // trust balance is read off, and the exhibit an 8-K's manifest yields. An
  // annotation whose type the barrel stopped exporting fails
  // `tsc -p tsconfig.test.json` naming it.
  const refresh: sec.CurrentTrustRefresh = {
    wouldRefresh: async () => false,
    refresh: async () => false,
  };
  const fact: Pick<sec.CompanyFact, "name" | "val"> = { name: "AssetsHeldInTrust", val: 1 };
  const exhibit: sec.SubmissionExhibit = {
    type: "EX-2.1",
    description: "AGREEMENT AND PLAN OF MERGER",
    filename: "ex21.htm",
  };
  expect(typeof refresh.refresh).toBe("function");
  expect(fact.val).toBe(1);
  expect(sec.formatExhibitDetail([exhibit])).toContain("ex21.htm");
});

test("exports the issuer tables and journals an out-of-package screen reads and writes", () => {
  for (const name of [
    "ENTITY_REPOSITORY_TOKEN",
    "ENTITY_HISTORY_REPOSITORY_TOKEN",
    "PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN",
    "S1_CLASSIFICATION_REPOSITORY_TOKEN",
    "CHANGE_LOG_REPOSITORY_TOKEN",
    "EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN",
  ]) {
    expect(sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBeDefined();
  }
  for (const name of ["loadAnsweredMergerSections", "filingRunKey", "isFirst20FAfterCombination"]) {
    expect(typeof sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBe("function");
  }

  // The key an already-run filing is looked up by. A caller builds it, the repo
  // answers a set of them, so the format is asserted rather than assumed.
  expect(sec.filingRunKey({ cik: 1811882, accession_number: "0001811882-26-000001" })).toBe(
    "1811882::0001811882-26-000001"
  );

  // The row types those tokens' storages hold are erased before this file runs,
  // so they are pinned by annotating the rows a screen actually seeds and the
  // storage the entity token resolves to. An annotation whose type the barrel
  // stopped exporting fails `tsc -p tsconfig.test.json` naming it.
  const entity: Pick<sec.Entity, "cik" | "name" | "sic"> = {
    cik: 1811882,
    name: "Alpha Acquisition Corp",
    sic: 6770,
  };
  const history: Pick<sec.EntityHistory, "cik" | "name" | "valid_from" | "valid_to"> = {
    cik: 1811882,
    name: "Alpha Holdings Inc",
    valid_from: "2026-01-01",
    valid_to: null,
  };
  const classification: Pick<
    sec.S1Classification,
    "extractor_id" | "accession_number" | "cik" | "is_spac"
  > = {
    extractor_id: "S-1",
    accession_number: "0001811882-26-000002",
    cik: 1811882,
    is_spac: true,
  };
  // Never called: it is the resolution itself that is being typed, and calling
  // it would need live DI. Annotating the return pins both the storage type and
  // that the token still resolves to it.
  const resolveEntities: () => sec.EntityRepositoryStorage = () =>
    sec.globalServiceRegistry.get(sec.ENTITY_REPOSITORY_TOKEN);

  expect(entity.sic).toBe(6770);
  expect(history.valid_to).toBeNull();
  expect(classification.is_spac).toBe(true);
  expect(typeof resolveEntities).toBe("function");
});

test("exports the document-download, backfill and CLI helpers an out-of-package command is built from", async () => {
  for (const name of [
    "parseOutputFormat",
    "submissionFetchKind",
    "assertInsideDir",
    "sanitizePrimaryDoc",
    "tmpPathFor",
    "describeFailureReason",
    "listBackfillableExtractorIds",
    "AsyncMutex",
    "TypeStringEnum",
    "SecFetchAccessionDocTask",
    "BackfillExtractorTask",
  ]) {
    expect(typeof sec[name as keyof typeof sec], `missing barrel export: ${name}`).toBe("function");
  }
  expect(sec.FORMS_SWEEP_CONCURRENCY_LIMIT).toBeGreaterThan(0);

  // `OutputFormat`, `SubmissionFetchKind` and `ExtractorId` are erased before
  // this file runs, so they are pinned by annotating what the functions beside
  // them actually return. An annotation whose type the barrel stopped exporting
  // fails `tsc -p tsconfig.test.json` naming it.
  const format: sec.OutputFormat = sec.parseOutputFormat("json");
  expect(format).toBe("json");

  // The one rule for which file a form is fetched as: an 8-K's news is in its
  // exhibits, and only the full submission carries them.
  const eightK: sec.SubmissionFetchKind = sec.submissionFetchKind("8-K");
  const ownership: sec.SubmissionFetchKind = sec.submissionFetchKind("4");
  expect(eightK).toBe("full-submission");
  expect(ownership).toBe("primary-doc");

  // The live vocabulary a `--force`-style argument is validated against, read
  // per call because the registry is filled after this module first loads.
  const ids: readonly sec.ExtractorId[] = sec.listBackfillableExtractorIds();
  expect(ids).toContain("S-1");

  // What keeps a filer-authored filename inside the cache directory.
  expect(sec.sanitizePrimaryDoc("  d8k.htm ")).toBe("d8k.htm");
  expect(() => sec.sanitizePrimaryDoc("../escape.htm")).toThrow();
  expect(() => sec.assertInsideDir("/raw/accessiondocs/d8k.htm", "/raw")).not.toThrow();
  expect(() => sec.assertInsideDir("/etc/passwd", "/raw")).toThrow();

  // The sibling temp name an atomic write renames from, and the single bounded
  // line a per-filing failure is recorded as.
  expect(sec.tmpPathFor("/raw/d8k.htm")).toMatch(/^\/raw\/d8k\.htm\.tmp\./);
  expect(sec.describeFailureReason(new Error("boom\n  again"), 200)).toBe("boom again");
  expect(sec.describeFailureReason(new Error("boom"), 3)).toBe("bo…");

  // A closed value set carried as JSON Schema `enum` rather than a bare string.
  const status = sec.TypeStringEnum(["ipo", "announced"]);
  expect(status.type).toBe("string");
  expect((status as { enum?: readonly string[] }).enum).toEqual(["ipo", "announced"]);

  // The lock a writer serialises its read-derive-write cycle on.
  const mutex = new sec.AsyncMutex();
  const order: number[] = [];
  await Promise.all([
    mutex.lock(async () => {
      order.push(1);
    }),
    mutex.lock(async () => {
      order.push(2);
    }),
  ]);
  expect(order).toEqual([1, 2]);

  // `ExtractorBackfillResult` is what a backfill run answers with; pinned by
  // annotating the counts a command renders.
  const result: sec.ExtractorBackfillResult = { selected: 2, processed: 1, skipped: 1 };
  expect(result.selected).toBe(result.processed + result.skipped);
});
