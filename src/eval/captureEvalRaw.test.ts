/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { StructuredOutputValidationError } from "workglow";
import { captureEvalRawFromError, captureEvalRawFromRows } from "./captureEvalRaw";

describe("captureEvalRawFromRows", () => {
  it("returns undefined when dumpRaw is false", () => {
    expect(captureEvalRawFromRows(false, [{ a: 1 }])).toBeUndefined();
  });

  it("returns kind rows when dumpRaw is true", () => {
    const rows = [{ full_name: "Ada" }];
    expect(captureEvalRawFromRows(true, rows)).toEqual({ kind: "rows", rows });
  });
});

describe("captureEvalRawFromError", () => {
  it("returns undefined when dumpRaw is false", () => {
    expect(captureEvalRawFromError(false, new Error("x"))).toBeUndefined();
  });

  it("maps StructuredOutputValidationError to kind validation", () => {
    const err = new StructuredOutputValidationError([
      {
        attempt: 1,
        errors: [{ path: "/persons", message: "expected array" }],
        object: { persons: "nope" },
      },
    ]);
    expect(captureEvalRawFromError(true, err)).toEqual({
      kind: "validation",
      attempts: err.attempts,
    });
  });

  it("maps other errors to kind none", () => {
    expect(captureEvalRawFromError(true, new Error("model not registered"))).toEqual({
      kind: "none",
    });
  });
});
