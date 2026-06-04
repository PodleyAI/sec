/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { resolveS1PrimaryDoc } from "./resolvePrimaryDoc";

describe("resolveS1PrimaryDoc", () => {
  it("returns the primary_doc filename, stripping an xsl viewer prefix", () => {
    expect(resolveS1PrimaryDoc({ primary_doc: "tv123-s1.htm" })).toBe("tv123-s1.htm");
    expect(resolveS1PrimaryDoc({ primary_doc: "xslF345X03/primary.htm" })).toBe("primary.htm");
  });

  it("returns null when no primary document is recorded", () => {
    expect(resolveS1PrimaryDoc({ primary_doc: "" })).toBeNull();
    expect(resolveS1PrimaryDoc({ primary_doc: null })).toBeNull();
  });
});
