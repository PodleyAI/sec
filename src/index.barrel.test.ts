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

  // `buildEntityObserver` needs live DI, so what is pinned here is its
  // signature: the versions it must be given and the observer it hands back.
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
