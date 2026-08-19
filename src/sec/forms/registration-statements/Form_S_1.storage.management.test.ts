/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { setupAllDatabases } from "../../../config/setupAllDatabases";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
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
});
