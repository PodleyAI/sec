/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "vitest";
import { globalServiceRegistry } from "workglow";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { ENTITY_REPOSITORY_TOKEN } from "../storage/entity/EntitySchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../storage/spac/SpacCandidateSchema";
import { SPAC_REPOSITORY_TOKEN, SpacSchema } from "../storage/spac/SpacSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../storage/dead-letter/ExtractionDeadLetterSchema";
import { handleWebRequest, overridesFromForm, type WebRequest, type WebResponse } from "./handler";
import { RunRegistry } from "./runs";

function get(path: string, query: Record<string, string> = {}): WebRequest {
  return {
    method: "GET",
    path,
    query: new URLSearchParams(query),
    form: new URLSearchParams(),
  };
}

function post(path: string, form: Record<string, string>): WebRequest {
  return {
    method: "POST",
    path,
    query: new URLSearchParams(),
    form: new URLSearchParams(form),
  };
}

function bodyOf(response: WebResponse): string {
  if (response.kind !== "response") throw new Error("expected a response, got an event stream");
  return response.body;
}

async function addEntity(cik: number, name: string, sic: number | null): Promise<void> {
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).put({
    cik,
    name,
    sic,
    type: null,
    ein: null,
    description: null,
    website: null,
    investor_website: null,
    category: null,
    fiscal_year: null,
    state_incorporation: null,
    state_incorporation_desc: null,
  });
}

async function addFiling(args: {
  readonly cik: number;
  readonly accession: string;
  readonly form: string;
  readonly date: string;
}): Promise<void> {
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).put({
    cik: args.cik,
    accession_number: args.accession,
    filing_date: args.date,
    report_date: null,
    acceptance_date: `${args.date}T12:00:00.000Z`,
    form: args.form,
    file_number: null,
    film_number: null,
    primary_doc: "doc.htm",
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  });
}

async function addCandidate(cik: number, name: string, confidence: string): Promise<void> {
  await globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN).put({
    cik,
    name,
    current_sic: 6770,
    signal_sic_6770: true,
    signal_filed_sic_6770: null,
    signal_name_match: true,
    signal_renamed_from: null,
    first_reg_form: "S-1",
    first_reg_date: "2025-01-02",
    reg_while_spac_named: null,
    confidence: confidence as "high",
    identified_at: "2026-08-01T00:00:00.000Z",
  });
}

describe("web handler", () => {
  let registry: RunRegistry;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    registry = new RunRegistry();
  });

  it("renders the overview against an empty database", async () => {
    const body = bodyOf(await handleWebRequest(get("/"), registry));
    expect(body).toContain("SPAC pipeline inspector");
    // The model roster is the operator's answer to "what would a run use", so
    // it must render even before anything has been ingested.
    expect(body).toContain("SEC_S1_MODEL");
  });

  it("lists candidates and links each one three ways", async () => {
    await addCandidate(1234, "Yuanxiang Acquisition Corp.", "high");
    const body = bodyOf(await handleWebRequest(get("/candidates"), registry));
    expect(body).toContain("Yuanxiang Acquisition Corp.");
    expect(body).toContain('href="/spac/1234"');
    expect(body).toContain('href="/spac/1234/process"');
    expect(body).toContain("sec.gov/cgi-bin/browse-edgar");
  });

  it("filters candidates by confidence and rejects an unknown tier", async () => {
    await addCandidate(1, "High Acquisition Corp", "high");
    await addCandidate(2, "Low Acquisition Corp", "low");

    const high = bodyOf(
      await handleWebRequest(get("/candidates", { confidence: "high" }), registry)
    );
    expect(high).toContain("High Acquisition Corp");
    expect(high).not.toContain("Low Acquisition Corp");

    const bad = await handleWebRequest(get("/candidates", { confidence: "nope" }), registry);
    expect(bad.kind === "response" && bad.status).toBe(400);
  });

  it("searches candidates by name and CIK", async () => {
    await addCandidate(4242, "Alpha Acquisition Corp", "high");
    await addCandidate(4343, "Beta Acquisition Corp", "high");

    const byName = bodyOf(await handleWebRequest(get("/candidates", { q: "alpha" }), registry));
    expect(byName).toContain("Alpha Acquisition Corp");
    expect(byName).not.toContain("Beta Acquisition Corp");

    const byCik = bodyOf(await handleWebRequest(get("/candidates", { q: "4343" }), registry));
    expect(byCik).toContain("Beta Acquisition Corp");
    expect(byCik).not.toContain("Alpha Acquisition Corp");
  });

  it("says plainly when an issuer has no spac row rather than rendering an empty report", async () => {
    await addEntity(777, "Nothing Acquisition Corp", 6770);
    const body = bodyOf(await handleWebRequest(get("/spac/777"), registry));
    expect(body).toContain("Nothing Acquisition Corp");
    expect(body).toContain("No <code>spac</code> row for this CIK");
  });

  it("renders the process checklist in filing-date order with per-step state", async () => {
    await addEntity(555, "Ordered Acquisition Corp", 6770);
    await addFiling({
      cik: 555,
      accession: "0000000000-25-000002",
      form: "424B4",
      date: "2025-03-01",
    });
    await addFiling({
      cik: 555,
      accession: "0000000000-25-000001",
      form: "S-1",
      date: "2025-01-01",
    });

    const body = bodyOf(await handleWebRequest(get("/spac/555/process"), registry));
    // The S-1 must be listed before the 424 — replaying by form type is exactly
    // what drops de-SPAC milestones, so the page has to show the real order.
    expect(body.indexOf("0000000000-25-000001")).toBeLessThan(body.indexOf("0000000000-25-000002"));
    expect(body).toContain("<strong>2</strong> filings on the timeline");
    expect(body).toContain("<strong>2</strong> filing(s) a plain replay would process");
  });

  it("shows a filing's recorded runs and dead letters", async () => {
    await addEntity(556, "Traced Acquisition Corp", 6770);
    await addFiling({
      cik: 556,
      accession: "0000000000-25-000009",
      form: "S-1",
      date: "2025-01-01",
    });
    await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).put({
      cik: 556,
      accession_number: "0000000000-25-000009",
      form: "S-1",
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      slot_at_run: "current",
      ran_at: "2026-08-01T00:00:00.000Z",
      success: false,
      outcome: "partial",
      error: null,
    });
    await globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN).put({
      extractor_id: "S-1",
      accession_number: "0000000000-25-000009",
      section_name: "Underwriting",
      reason_code: "MODEL_EMPTY",
      detail: "no rows",
      failed_extractor_version: "1.0.0",
      status: "pending",
      attempts: 1,
      first_seen_at: "2026-08-01T00:00:00.000Z",
      last_attempt_at: "2026-08-01T00:00:00.000Z",
      source_run_id: null,
    });

    const body = bodyOf(
      await handleWebRequest(
        get("/spac/556/filing/0000000000-25-000009", { tab: "extractions" }),
        registry
      )
    );
    expect(body).toContain("MODEL_EMPTY");
    expect(body).toContain("Underwriting");
    expect(body).toContain("partial");
  });

  it("reports a missing cached document instead of an empty conversion", async () => {
    await addEntity(557, "Uncached Acquisition Corp", 6770);
    await addFiling({
      cik: 557,
      accession: "0000000000-25-000010",
      form: "S-1",
      date: "2025-01-01",
    });
    const body = bodyOf(
      await handleWebRequest(get("/spac/557/filing/0000000000-25-000010"), registry)
    );
    // "we never downloaded it" and "the converter produced nothing" are
    // different problems; the page must not present the first as the second.
    expect(body).toMatch(/accession-doc cache|SEC_RAW_DATA_FOLDER/);
  });

  it("enqueues a candidate rebuild and redirects to its run", async () => {
    const response = await handleWebRequest(post("/api/candidates/rebuild", {}), registry);
    expect(response.kind === "response" && response.status).toBe(303);
    const runs = registry.list();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.label).toContain("SPAC candidates");
  });

  it("enqueues a single-filing re-run when a step's Run button is pressed", async () => {
    await addFiling({
      cik: 558,
      accession: "0000000000-25-000011",
      form: "S-1",
      date: "2025-01-01",
    });
    await handleWebRequest(
      post("/api/process", {
        cik: "558",
        accession: "0000000000-25-000011",
        model_s1: "claude-haiku-4-5",
      }),
      registry
    );
    const run = registry.list()[0]!;
    expect(run.kind).toBe("filing");
    expect(run.cik).toBe(558);
    expect(run.overrides).toContain("SEC_S1_MODEL=claude-haiku-4-5");
  });

  it("treats a rebuild request as a forced replay of the whole timeline", async () => {
    await handleWebRequest(post("/api/process", { cik: "559", mode: "rebuild" }), registry);
    expect(registry.list()[0]!.label).toContain("rebuild every filing");
  });

  it("says a named filing is not on the timeline rather than 'nothing outstanding'", async () => {
    await addFiling({
      cik: 561,
      accession: "0000000000-25-000020",
      form: "S-1",
      date: "2025-01-01",
    });
    await handleWebRequest(
      post("/api/process", { cik: "561", accession: "0000000000-25-999999" }),
      registry
    );
    const run = registry.list()[0]!;
    // A safety net against a hang, not a timing assertion — see `settle` in
    // runs.test.ts. The body reads in-memory storage and settles immediately.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && registry.get(run.id)!.status !== "succeeded") {
      await new Promise((r) => setTimeout(r, 5));
    }
    const messages = registry.get(run.id)!.events.map((e) => e.message);
    // A sweep with nothing to do is the healthy steady state; a named filing
    // this issuer does not have is a request that asked for the wrong thing.
    expect(messages.some((m) => m.includes("are on this issuer's timeline"))).toBe(true);
    expect(messages.some((m) => m.includes("nothing outstanding"))).toBe(false);
  });

  it("rejects a non-numeric CIK rather than querying with it", async () => {
    const response = await handleWebRequest(post("/api/process", { cik: "abc" }), registry);
    expect(response.kind === "response" && response.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });

  it("routes /events to the stream rather than a body", async () => {
    const response = await handleWebRequest(get("/events", { cik: "42" }), registry);
    expect(response.kind).toBe("sse");
    expect(response.kind === "sse" && response.cik).toBe(42);
  });

  it("escapes filer-authored text rather than rendering it as markup", async () => {
    await addCandidate(9, '<img src=x onerror="alert(1)">', "high");
    const body = bodyOf(await handleWebRequest(get("/candidates"), registry));
    expect(body).not.toContain("<img src=x");
    expect(body).toContain("&lt;img src=x");
  });

  it("resolves a spac row when one exists", async () => {
    await addEntity(560, "Real Acquisition Corp", 6770);
    await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).put(spacRow(560) as never);
    const body = bodyOf(await handleWebRequest(get("/spac/560"), registry));
    expect(body).toContain("Real Acquisition Corp");
    expect(body).not.toContain("No <code>spac</code> row");
  });

  it("rejects a malformed accession rather than composing a cache path from it", async () => {
    const bad = await handleWebRequest(get("/spac/1/filing/..%2F..%2Fetc%2Fpasswd"), registry);
    expect(bad.kind === "response" && bad.status).toBe(400);

    const badCompare = await handleWebRequest(
      post("/api/compare", { cik: "1", accession: "../../etc/passwd", extractor: "management" }),
      registry
    );
    expect(badCompare.kind === "response" && badCompare.status).toBe(400);

    const badRun = await handleWebRequest(
      post("/api/process", { cik: "1", accession: "../../etc" }),
      registry
    );
    expect(badRun.kind === "response" && badRun.status).toBe(400);
    expect(registry.list()).toHaveLength(0);
  });

  it("404s an unknown path", async () => {
    const response = await handleWebRequest(get("/nope"), registry);
    expect(response.kind === "response" && response.status).toBe(404);
  });
});

describe("overridesFromForm", () => {
  it("applies a free-text id to every slot the picker left unchanged", () => {
    const { overrides, models } = overridesFromForm(
      new URLSearchParams({ model_s1: "claude-opus-5", model_free: "claude-haiku-4-5" })
    );
    expect(overrides["s1"]).toBe("claude-opus-5");
    expect(overrides["risk-factors"]).toBe("claude-haiku-4-5");
    expect([...models].sort()).toEqual(["claude-haiku-4-5", "claude-opus-5"]);
  });

  it("sets nothing when no model was chosen", () => {
    const { overrides, models } = overridesFromForm(new URLSearchParams());
    expect(Object.keys(overrides)).toHaveLength(0);
    expect(models).toHaveLength(0);
  });
});

/**
 * A minimal `spac` row, built from the schema so a newly added column does not
 * silently turn this fixture into a validation failure in an unrelated test.
 */
function spacRow(cik: number): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(SpacSchema.properties as Record<string, unknown>)) {
    row[name] = null;
    void prop;
  }
  return {
    ...row,
    cik,
    status: "registered",
    spac_name: "Real Acquisition Corp",
    spac_sic: 6770,
    current_sic: 6770,
    registration_date: "2025-01-01",
    as_of: "2025-01-01",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}
