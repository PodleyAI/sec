/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { PersonRoleRepo } from "../../../storage/canonical/PersonRoleRepo";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { processFormS1 } from "./Form_S_1.storage";
import { DETERMINISTIC_MODEL_ID } from "./s1/parseOfferingTables";
import { fakeS1Model, registerFakeStructuredProvider } from "./s1/testing/fakeStructuredProvider";

const HTML_PARSEABLE = [
  "<h1>MANAGEMENT</h1>",
  "<table>",
  "<tr><td>Name</td><td>Age</td><td>Title</td></tr>",
  "<tr><td>Jane Roe</td><td>52</td><td>Director</td></tr>",
  "</table>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

// The roster the parser reads: one person it can see. The prose line below it
// names an officer no table row carries, which the AI path reads and the table
// walk cannot.
const HTML_PARTIAL_ROSTER = [
  "<h1>MANAGEMENT</h1>",
  "<table>",
  "<tr><td>Name</td><td>Age</td><td>Title</td></tr>",
  "<tr><td>Jane Roe</td><td>52</td><td>Director</td></tr>",
  "</table>",
  "<p>John Doe continues to serve as our Chief Financial Officer.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const HTML_PROSE_ROSTER = [
  "<h1>MANAGEMENT</h1>",
  "<p>Jane Roe — Director. John Doe — Chief Financial Officer.</p>",
  "<h1>LEGAL MATTERS</h1><p>x</p>",
].join("");

const BOTH_OFFICERS_PAYLOAD = {
  people: [
    {
      full_name: "Jane Roe",
      titles: ["Director"],
      relationship: null,
      confidence: 0.9,
      source_span: "Jane Roe — Director",
    },
    {
      full_name: "John Doe",
      titles: ["Chief Financial Officer"],
      relationship: null,
      confidence: 0.9,
      source_span: "John Doe — Chief Financial Officer",
    },
  ],
};

const NULL_HEADER = {
  sic: null,
  sicDescription: null,
  cik: null,
  companyName: null,
  filingDate: null,
};

let cleanup: (() => void) | undefined;

describe("processFormS1 management roster", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });
  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetDependencyInjectionsForTesting();
  });

  it("persists a parseable roster as deterministic without calling the management model", async () => {
    const { calls, unregister } = registerFakeStructuredProvider([{}]);
    cleanup = unregister;

    await processFormS1({
      cik: 1018724,
      file_number: "333-1",
      accession_number: "acc-mgmt-1",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: HTML_PARSEABLE,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const people = (await new PersonObservationRepo().listAll()).filter(
      (o) => o.relationship === "s1:management"
    );
    expect(people.map((p) => [p.first_name, p.last_name])).toEqual([["Jane", "Roe"]]);
    expect(calls.some((p) => /Extract every director and executive officer/.test(p))).toBe(false);
    const provenance = await new ObservationProvenanceRepo().get(
      "person",
      people[0]!.observation_id
    );
    expect(provenance?.model_id).toBe(DETERMINISTIC_MODEL_ID);
  });

  it("does not close a role the roster parse never claimed to have enumerated", async () => {
    const { unregister } = registerFakeStructuredProvider([BOTH_OFFICERS_PAYLOAD]);
    cleanup = unregister;

    // First filing (prose roster, AI path): both officers hold open roles.
    await processFormS1({
      cik: 1018724,
      file_number: "333-2",
      accession_number: "acc-mgmt-role-1",
      filing_date: "2026-01-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: HTML_PROSE_ROSTER,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const opened = await new PersonRoleRepo().listForCompany(1018724, "1.0.0");
    expect(opened.map((r) => r.title).sort()).toEqual(["Chief Financial Officer", "Director"]);

    // Second filing: the table walk reads one of the two, and the filing still
    // names the other. The parser filters its own output, so "every row I
    // returned survived" is not evidence that it read the whole roster.
    await processFormS1({
      cik: 1018724,
      file_number: "333-2",
      accession_number: "acc-mgmt-role-2",
      filing_date: "2026-02-02",
      primary_doc: "s1.htm",
      form: "S-1",
      formS1: {
        header: NULL_HEADER,
        html: HTML_PARTIAL_ROSTER,
        xbrlInstanceXml: null,
        feeExhibitHtml: null,
      },
      model: fakeS1Model(),
    });

    const roles = await new PersonRoleRepo().listForCompany(1018724, "1.0.0");
    const cfo = roles.find((r) => r.title === "Chief Financial Officer");
    expect(cfo).toBeDefined();
    expect(cfo!.end_date).toBeNull();
  });
});
