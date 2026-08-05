/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { classifyFactsFetchError } from "./classifyFactsFetchError";
import { NoXbrlFactsError } from "./NoXbrlFactsError";

describe("classifyFactsFetchError", () => {
  it("classifies a facts-less 200 body as NO_XBRL_FACTS", () => {
    // data.sec.gov answers `200 {}` for a filer with no XBRL, so there is no
    // status to key off — only the typed error from FetchCompanyFactsTask.
    expect(classifyFactsFetchError(new NoXbrlFactsError(3521))).toBe("NO_XBRL_FACTS");
  });

  it("classifies a wrapped NoXbrlFactsError as NO_XBRL_FACTS", () => {
    expect(
      classifyFactsFetchError({
        name: "JobTaskFailedError",
        message: "job failed",
        cause: { name: "NoXbrlFactsError", message: "no 'facts' object" },
      })
    ).toBe("NO_XBRL_FACTS");
    expect(
      classifyFactsFetchError({
        name: "JobTaskFailedError",
        message: "job failed",
        jobError: { name: "NoXbrlFactsError" },
      })
    ).toBe("NO_XBRL_FACTS");
  });

  it("classifies a 404 status as NO_XBRL_FACTS", () => {
    expect(classifyFactsFetchError({ status: 404 })).toBe("NO_XBRL_FACTS");
    expect(classifyFactsFetchError({ statusCode: 404 })).toBe("NO_XBRL_FACTS");
    expect(classifyFactsFetchError({ response: { status: 404 } })).toBe("NO_XBRL_FACTS");
  });

  it("classifies a 404 surfaced only in the error message as NO_XBRL_FACTS", () => {
    expect(classifyFactsFetchError(new Error("Failed to fetch: 404 Not Found"))).toBe(
      "NO_XBRL_FACTS"
    );
  });

  it("classifies other HTTP statuses as FETCH_ERROR", () => {
    expect(classifyFactsFetchError({ status: 503 })).toBe("FETCH_ERROR");
    expect(classifyFactsFetchError(new Error("Failed to fetch: 429 Too Many Requests"))).toBe(
      "FETCH_ERROR"
    );
  });

  it("classifies network-level failures as FETCH_ERROR", () => {
    const err = new Error("socket hang up") as NodeJS.ErrnoException;
    err.code = "ECONNRESET";
    expect(classifyFactsFetchError(err)).toBe("FETCH_ERROR");
    expect(classifyFactsFetchError(new Error("fetch failed"))).toBe("FETCH_ERROR");
    expect(classifyFactsFetchError(new Error("Connect Timeout Error"))).toBe("FETCH_ERROR");
  });

  it("classifies DNS failures as FETCH_ERROR", () => {
    // SafeFetch surfaces these as a PermanentJobError whose errno lives in the
    // message text, not in `.code`.
    expect(
      classifyFactsFetchError(
        new Error("PermanentJobError: DNS lookup failed for 'data.sec.gov': getaddrinfo ENOTFOUND")
      )
    ).toBe("FETCH_ERROR");
    expect(
      classifyFactsFetchError(new Error("DNS lookup returned no addresses for 'data.sec.gov'"))
    ).toBe("FETCH_ERROR");
    expect(
      classifyFactsFetchError({
        name: "PermanentJobError",
        code: "FETCH_DNS_FAILED",
        message: "DNS lookup failed for 'data.sec.gov': getaddrinfo EAI_AGAIN",
      })
    ).toBe("FETCH_ERROR");
  });

  it("classifies statusless non-network errors as PARSE_ERROR", () => {
    expect(classifyFactsFetchError(new TypeError("undefined is not an object"))).toBe(
      "PARSE_ERROR"
    );
    expect(classifyFactsFetchError("boom")).toBe("PARSE_ERROR");
  });

  it("classifies workglow retryable job errors as FETCH_ERROR even without a matching message", () => {
    expect(
      classifyFactsFetchError({ name: "RetryableJobError", retryable: true, message: "hiccup" })
    ).toBe("FETCH_ERROR");
    // JobTaskFailedError wraps the original job error in `jobError`.
    expect(
      classifyFactsFetchError({
        name: "JobTaskFailedError",
        message: "job failed",
        jobError: { name: "RetryableJobError", retryable: true },
      })
    ).toBe("FETCH_ERROR");
  });

  it("reads the HTTP status from a wrapped job error's structured fields", () => {
    expect(
      classifyFactsFetchError({
        name: "JobTaskFailedError",
        message: "job failed permanently",
        jobError: { name: "PermanentJobError", httpStatus: 404 },
      })
    ).toBe("NO_XBRL_FACTS");
    expect(classifyFactsFetchError({ httpStatus: 503 })).toBe("FETCH_ERROR");
  });

  it("ignores message numbers outside the HTTP status range", () => {
    expect(classifyFactsFetchError(new Error("unexpected token at position: 999 in"))).toBe(
      "PARSE_ERROR"
    );
  });
});
