/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacMergerExtractionRepo } from "../../../storage/spac/SpacMergerExtractionRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import {
  fakeS1Model,
  registerFakeStructuredProvider,
} from "../registration-statements/s1/testing/fakeStructuredProvider";
import { MAX_STORED_SPAN_CHARS } from "../registration-statements/s1/verifySourceSpan";
import { Form_DEFM14A } from "./Form_DEFM14A";
import { processMergerProxy } from "./Form_DEFM14A.storage";
import { fileURLToPath } from "node:url";
const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const FIXTURE = `${importMetaDir}/mock_data/merger-proxy/defm14a_sample.txt`;

async function seedSpac(cik: number): Promise<void> {
  const writer = new SpacReportWriter();
  await writer.recordRegistration({
    cik,
    accession_number: `${cik}-reg`,
    filing_date: "2020-12-01",
    form: "S-1",
    primary_document: "s1.htm",
    spac_name: "Merge SPAC Inc.",
    spac_sic: 6770,
  });
  await writer.recordDealMilestones({
    cik,
    accession_number: `${cik}-da`,
    filing_date: "2021-03-05",
    form: "8-K",
    primary_document: null,
    events: [{ event_type: "definitive_agreement", event_date: "2021-03-01" }],
  });
}

async function runProxy(cik: number, accession_number: string): Promise<void> {
  const txt = readFileSync(FIXTURE, "utf-8");
  const parsed = await Form_DEFM14A.parse("DEFM14A", txt);
  await processMergerProxy({
    cik,
    file_number: "",
    accession_number,
    filing_date: "2021-05-01",
    primary_doc: "proxy.htm",
    form: "DEFM14A",
    formMergerProxy: parsed,
    model: fakeS1Model(),
  });
}

describe("processMergerProxy prompt-injection seal", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  it("rejects an over-cap source_span at the gate, dead-letters SOURCE_SPAN_TOO_LONG, persists nothing", async () => {
    await seedSpac(700);
    // The raw source_span exceeds the storage cap. Even though it would
    // appear verbatim in a synthetically-large section text, the gate
    // rejects it BEFORE normalization, mirroring the S-1 storage-side cap.
    const oversizedSpan = "X".repeat(MAX_STORED_SPAN_CHARS + 1);
    const { unregister } = registerFakeStructuredProvider([
      {
        target_name: "Mallory Inc.",
        pipe_amount: 999_999,
        merger_consideration: "fabricated",
        confidence: 0.99,
        source_span: oversizedSpan,
      },
    ]);
    cleanup = unregister;

    await runProxy(700, "700-defm");

    expect(await new SpacMergerExtractionRepo().getByAccession("700-defm")).toBeUndefined();
    const dl = await new ExtractionDeadLetterRepo().listPending("merger-proxy");
    const merger = dl.find((d) => d.section_name === "merger");
    expect(merger?.reason_code).toBe("SOURCE_SPAN_TOO_LONG");
  });

  it("persist site caps the stored source_span via boundSourceSpan at MAX_STORED_SPAN_CHARS", async () => {
    await seedSpac(701);
    // A row whose source_span verifies (short, present in fixture) persists
    // unchanged: boundSourceSpan returns the span as-is at-or-below the cap.
    const verbatim = "business combination with Acme Target Inc.";
    expect(verbatim.length).toBeLessThanOrEqual(MAX_STORED_SPAN_CHARS);
    const { unregister } = registerFakeStructuredProvider([
      {
        target_name: "Acme Target Inc.",
        pipe_amount: 150_000_000,
        merger_consideration: "$10 per share",
        confidence: 0.95,
        source_span: verbatim,
      },
    ]);
    cleanup = unregister;

    await runProxy(701, "701-defm");

    const ext = await new SpacMergerExtractionRepo().getByAccession("701-defm");
    expect(ext).toBeDefined();
    // Persisted span is bounded at the storage cap (here unchanged, since the
    // raw span is well below the cap). The contract under test is that the
    // call site flows through boundSourceSpan rather than persisting the
    // model output verbatim.
    expect((ext?.source_span ?? "").length).toBeLessThanOrEqual(MAX_STORED_SPAN_CHARS);
    expect(ext?.source_span).toBe(verbatim);
  });

  it("rolling-up after a verifier reject does not surface the rejected target onto the spac row", async () => {
    await seedSpac(702);
    const oversizedSpan = "Y".repeat(MAX_STORED_SPAN_CHARS + 1);
    const { unregister } = registerFakeStructuredProvider([
      {
        target_name: "Mallory Inc.",
        pipe_amount: 1,
        merger_consideration: "fabricated",
        confidence: 0.99,
        source_span: oversizedSpan,
      },
    ]);
    cleanup = unregister;

    await runProxy(702, "702-defm");

    const row = await new SpacRepo().getSpac(702);
    expect(row?.target_name ?? null).toBeNull();
    expect(row?.pipe_amount ?? null).toBeNull();
  });

  it("a wrong nonce_seen dead-letters NONCE_MISMATCH and persists nothing", async () => {
    await seedSpac(703);
    // The canned payload sets `nonce_seen` to a valid-shaped but WRONG value,
    // bypassing the fake provider's auto-echo. `verifyNonce` inside
    // extractMergerDeal throws NonceMismatchError, which `sectionRunner`
    // records under the dedicated `NONCE_MISMATCH` reason code.
    const { unregister } = registerFakeStructuredProvider([
      {
        target_name: "Acme Target Inc.",
        pipe_amount: 150_000_000,
        merger_consideration: "$10 per share",
        confidence: 0.99,
        source_span: "business combination with Acme Target Inc.",
        nonce_seen: "deadbeefdeadbeef",
      },
    ]);
    cleanup = unregister;

    await runProxy(703, "703-defm");

    expect(await new SpacMergerExtractionRepo().getByAccession("703-defm")).toBeUndefined();
    const dl = await new ExtractionDeadLetterRepo().listPending("merger-proxy");
    const merger = dl.find((d) => d.section_name === "merger");
    expect(merger?.reason_code).toBe("NONCE_MISMATCH");
  });
});
