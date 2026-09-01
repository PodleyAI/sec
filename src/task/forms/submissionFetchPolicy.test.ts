/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import {
  conversionCandidates,
  conversionFetchFileName,
} from "../document/ConvertFilingDocumentTask";
import { fullSubmissionFileName, submissionFetchKind } from "./submissionFetchPolicy";

const ACC = "0001213900-26-000001";

describe("submissionFetchKind", () => {
  it("fetches EVERY 8-K whole, with no gate", () => {
    // The point of the rule. An 8-K's primary document is routinely four
    // sentences pointing at the EX-99.1 that carries the news, and there is no
    // property of a filing that makes that untrue for some 8-Ks.
    expect(submissionFetchKind("8-K")).toBe("full-submission");
    expect(submissionFetchKind("8-K/A")).toBe("full-submission");
  });

  it("keeps the registration and Reg A families whole", () => {
    for (const form of ["S-1", "S-1/A", "DRS", "F-1", "424B4", "424B7", "1-K", "1-K/A"]) {
      expect(submissionFetchKind(form), form).toBe("full-submission");
    }
  });

  it("leaves every other form on its primary document", () => {
    for (const form of ["10-K", "10-Q", "4", "DEF 14A", "DEFM14A", "1-SA", "D"]) {
      expect(submissionFetchKind(form), form).toBe("primary-doc");
    }
  });
});

describe("conversion fetch choice", () => {
  it("probes the full submission first, whatever the form", () => {
    // A cache probe is a stat, not a request, so looking for the richer shape
    // costs nothing even for a form nothing fetches whole.
    expect(conversionCandidates(ACC, "proxy.htm")).toEqual([`${ACC}.txt`, "proxy.htm"]);
  });

  it("FETCHES only what the shared policy would have fetched", () => {
    // Fetching a `.txt` for a form the pipeline caches as a primary document
    // would put two shapes on disk for one filing — the drift the shared policy
    // exists to end.
    expect(conversionFetchFileName("8-K", ACC, "form8k.htm")).toBe(fullSubmissionFileName(ACC));
    expect(conversionFetchFileName("S-1", ACC, "s1.htm")).toBe(fullSubmissionFileName(ACC));
    expect(conversionFetchFileName("DEFM14A", ACC, "proxy.htm")).toBe("proxy.htm");
  });

  it("falls back to the full submission when a filing names no primary document", () => {
    expect(conversionFetchFileName("DEFM14A", ACC, null)).toBe(fullSubmissionFileName(ACC));
    expect(conversionFetchFileName(null, ACC, "  ")).toBe(fullSubmissionFileName(ACC));
  });

  it("strips EDGAR's inline-XBRL viewer prefix so both halves of the round trip agree", () => {
    expect(conversionFetchFileName("4", ACC, "xslF345X03/wf-form4.xml")).toBe("wf-form4.xml");
  });
});
