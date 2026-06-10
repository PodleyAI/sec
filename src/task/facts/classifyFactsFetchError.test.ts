/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { classifyFactsFetchError } from "./classifyFactsFetchError";

describe("classifyFactsFetchError", () => {
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

  it("classifies statusless non-network errors as PARSE_ERROR", () => {
    expect(classifyFactsFetchError(new TypeError("undefined is not an object"))).toBe(
      "PARSE_ERROR"
    );
    expect(classifyFactsFetchError("boom")).toBe("PARSE_ERROR");
  });
});
