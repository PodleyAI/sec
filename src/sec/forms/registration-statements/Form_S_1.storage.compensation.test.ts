/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { PersonRoleRepo } from "../../../storage/canonical/PersonRoleRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { ExecutiveCompensationRepo } from "../../../storage/executive-compensation/ExecutiveCompensationRepo";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

// The segmenter renders the HTML table as Markdown, so the verifyRow gate needs
// a substring that matches the rendered table row literally.
const COMP_TABLE_ROW = "| Alina Kowalczyk |  | 2025 |";

const HTML_WITH_TABLE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Alina Kowalczyk — Chief Executive Officer</p>",
  "<h1>EXECUTIVE COMPENSATION</h1>",
  "<p>Summary Compensation Table. Name and Principal Position. Salary.</p>",
  "<p>| Alina Kowalczyk |  | 2025 |</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const HTML_PARSEABLE_TABLE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Alina Kowalczyk — Chief Executive Officer</p>",
  "<h1>EXECUTIVE COMPENSATION</h1>",
  "<p>Summary Compensation Table</p>",
  "<table>",
  "<tr><td>Name and Principal Position</td><td>Year</td><td>Salary ($)</td><td>Total ($)</td></tr>",
  "<tr><td>Alina Kowalczyk</td><td>2025</td><td>612,500</td><td>4,230,200</td></tr>",
  "<tr><td>Chief Executive Officer</td><td></td><td></td><td></td></tr>",
  "</table>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

// A blank-check company's compensation section: a heading and one sentence.
const HTML_NO_TABLE = [
  "<h1>MANAGEMENT</h1>",
  "<p>Alina Kowalczyk — Chief Executive Officer</p>",
  "<h1>EXECUTIVE OFFICER AND DIRECTOR COMPENSATION</h1>",
  "<p>None of our executive officers or directors has received any compensation for services",
  " rendered to us. We will not pay any compensation prior to the completion of our initial",
  " business combination.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

const MANAGEMENT_PAYLOAD = {
  people: [
    {
      full_name: "Alina Kowalczyk",
      titles: ["Chief Executive Officer"],
      relationship: null,
      confidence: 0.9,
      source_span: "Alina Kowalczyk — Chief Executive Officer",
    },
  ],
};

function compensationRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    person_name: "Alina Kowalczyk",
    principal_position: "Chief Executive Officer",
    fiscal_year: 2025,
    salary: 612500,
    bonus: null,
    stock_awards: null,
    option_awards: 3180400,
    non_equity_incentive: null,
    pension_and_nqdc: null,
    all_other_compensation: 12300,
    total: 4230200,
    footnote: null,
    confidence: 0.9,
    source_span: COMP_TABLE_ROW,
    ...over,
  };
}

function compensationPayload(): Record<string, unknown> {
  return { rows: [compensationRow()] };
}

async function run(html: string, accession: string): Promise<void> {
  await processFormS1({
    cik: 1018724,
    file_number: "333-1",
    accession_number: accession,
    filing_date: "2026-01-02",
    primary_doc: "s1.htm",
    form: "S-1",
    formS1: { header: NULL_HEADER, html, xbrlInstanceXml: null, feeExhibitHtml: null },
    model: fakeS1Model(),
  });
}

let cleanup: (() => void) | undefined;

describe("processFormS1 executive compensation", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("persists a compensation row linked to the officer's observation", async () => {
    // The scripted payloads are consumed in section order, and a section the
    // segmenter did not find never reaches the provider — this fixture has only
    // a management and a compensation section, so those are the only two calls.
    const { unregister } = registerFakeStructuredProvider([
      MANAGEMENT_PAYLOAD,
      compensationPayload(),
    ]);
    cleanup = unregister;

    await run(HTML_WITH_TABLE, "acc-comp-1");

    const rows = await new ExecutiveCompensationRepo().queryByAccession("acc-comp-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].fiscal_year).toBe(2025);
    expect(rows[0].salary).toBe(612500);
    expect(rows[0].total).toBe(4230200);
    expect(rows[0].principal_position).toBe("Chief Executive Officer");
    // Non-scaled columns this filing does not report stay null rather than 0.
    expect(rows[0].non_equity_incentive).toBeNull();
    expect(rows[0].pension_and_nqdc).toBeNull();

    const observations = await new PersonObservationRepo().listAll();
    const neo = observations.find((o) => o.relationship === "s1:named-executive-officer");
    expect(neo).toBeDefined();
    expect(rows[0].observation_id).toBe(neo?.observation_id);

    const provenance = await new ObservationProvenanceRepo().get("person", neo!.observation_id);
    expect(provenance?.section_name).toBe("Executive Compensation");
  });

  it("writes one row per fiscal year against a single person observation", async () => {
    const { unregister } = registerFakeStructuredProvider([
      { people: [] },
      {
        rows: [
          compensationRow(),
          compensationRow({ fiscal_year: 2024, salary: 570000, total: 2806800 }),
        ],
      },
    ]);
    cleanup = unregister;

    await run(HTML_WITH_TABLE, "acc-comp-5");

    const rows = await new ExecutiveCompensationRepo().queryByAccession("acc-comp-5");
    expect(rows.map((r) => r.fiscal_year).sort()).toEqual([2024, 2025]);
    expect(rows.map((r) => r.row_index).sort()).toEqual([0, 1]);
    // Two compensation facts, one mention of the officer.
    expect(new Set(rows.map((r) => r.observation_id)).size).toBe(1);
    const neos = (await new PersonObservationRepo().listAll()).filter(
      (o) => o.relationship === "s1:named-executive-officer"
    );
    expect(neos).toHaveLength(1);
  });

  it("mints no person_role tenure from the compensation table", async () => {
    // The table names only the named executive officers — a strict subset of the
    // management roster — so it must never participate in the dated-role
    // population the management section closes against.
    const { unregister } = registerFakeStructuredProvider([{ people: [] }, compensationPayload()]);
    cleanup = unregister;

    await run(HTML_WITH_TABLE, "acc-comp-2");

    expect(await new ExecutiveCompensationRepo().queryByAccession("acc-comp-2")).toHaveLength(1);
    expect(await new PersonRoleRepo().listForCompany(1018724, "1.0.0")).toEqual([]);
  });

  it("re-extraction replaces rather than accumulates rows", async () => {
    const { unregister } = registerFakeStructuredProvider([
      MANAGEMENT_PAYLOAD,
      compensationPayload(),
      MANAGEMENT_PAYLOAD,
      compensationPayload(),
    ]);
    cleanup = unregister;

    await run(HTML_WITH_TABLE, "acc-comp-3");
    await run(HTML_WITH_TABLE, "acc-comp-3");

    expect(await new ExecutiveCompensationRepo().queryByAccession("acc-comp-3")).toHaveLength(1);
  });

  it("skips the AI call for a blank-check company's no-compensation section", async () => {
    const { calls, unregister } = registerFakeStructuredProvider([MANAGEMENT_PAYLOAD]);
    cleanup = unregister;

    await run(HTML_NO_TABLE, "acc-comp-4");

    expect(await new ExecutiveCompensationRepo().queryByAccession("acc-comp-4")).toEqual([]);
    expect(calls.some((p) => /SUMMARY COMPENSATION TABLE/.test(p))).toBe(false);
    // No table is not a failure: the section must not sit on the retry worklist.
    const pending = await new ExtractionDeadLetterRepo().listPending("S-1");
    expect(pending.map((d) => d.section_name)).not.toContain("Executive Compensation");
  });

  it("leaves no dead letter — and resolves a prior one — when there is no compensation section at all", async () => {
    // Most registration statements have no compensation section. Dead-lettering
    // that would put an `Executive Compensation` entry on the retry worklist for
    // the majority of all S-1s, permanently, burying every triageable entry.
    const deadLetters = new ExtractionDeadLetterRepo();
    await deadLetters.record({
      extractor_id: "S-1",
      accession_number: "acc-comp-6",
      section_name: "Executive Compensation",
      reason_code: "SECTION_NOT_FOUND",
      detail: "recorded by a previous extractor version",
      failed_extractor_version: "0.9.0",
      source_run_id: null,
    });

    const { calls, unregister } = registerFakeStructuredProvider([MANAGEMENT_PAYLOAD]);
    cleanup = unregister;

    await run(
      [
        "<h1>MANAGEMENT</h1>",
        "<p>Alina Kowalczyk — Chief Executive Officer</p>",
        "<h1>LEGAL MATTERS</h1><p>x</p>",
      ].join(""),
      "acc-comp-6"
    );

    expect(await new ExecutiveCompensationRepo().queryByAccession("acc-comp-6")).toEqual([]);
    expect(calls.some((p) => /SUMMARY COMPENSATION TABLE/.test(p))).toBe(false);
    const pending = await deadLetters.listPending("S-1");
    expect(pending.map((d) => d.section_name)).not.toContain("Executive Compensation");
    expect((await deadLetters.get("S-1", "acc-comp-6", "Executive Compensation"))?.status).toBe(
      "resolved"
    );
  });

  it("still calls the compensation model on a table the grid walk can read", async () => {
    // Every money column is read off the grid, but `footnote` is not — and the
    // prompt tells the model to strip footnote markers out of `person_name` and
    // out of every money field, so a footnote's text lands on the row in no
    // other column. Nulling it deletes what the filing said, so this parse does
    // not stand in for the model.
    const { calls, unregister } = registerFakeStructuredProvider([
      MANAGEMENT_PAYLOAD,
      {
        rows: [
          compensationRow({
            footnote: "Represents 401(k) matching contributions paid by the Company.",
            source_span: "Alina Kowalczyk",
          }),
        ],
      },
    ]);
    cleanup = unregister;

    await run(HTML_PARSEABLE_TABLE, "acc-comp-7");

    const rows = await new ExecutiveCompensationRepo().queryByAccession("acc-comp-7");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fiscal_year).toBe(2025);
    expect(rows[0]!.salary).toBe(612500);
    expect(rows[0]!.total).toBe(4230200);
    expect(rows[0]!.principal_position).toBe("Chief Executive Officer");
    expect(rows[0]!.footnote).toBe("Represents 401(k) matching contributions paid by the Company.");
    expect(calls.some((p) => /SUMMARY COMPENSATION TABLE/.test(p))).toBe(true);
  });
});
