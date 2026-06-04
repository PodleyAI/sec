/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseRegistrationSubmission } from "./parseSubmission";

const FIXTURE = path.join(
  import.meta.dir,
  "../../../html/mock_data/s1/drs_1848507_000119312521066104.txt"
);

describe("DRS .txt fixture", () => {
  it("parses the SGML header (SIC 6770) and selects the primary DRS document", () => {
    const txt = readFileSync(FIXTURE, "utf-8");
    const parsed = parseRegistrationSubmission("DRS", txt);
    expect(parsed.header.sic).toBe(6770);
    expect(parsed.header.sicDescription).toBe("BLANK CHECKS");
    expect(parsed.header.cik).toBe(1848507);
    expect(parsed.html).toContain("MANAGEMENT");
    expect(parsed.html).toContain("Synthetic Sponsor 1, LLC");
    expect(parsed.html).not.toContain("auditor consent"); // exhibit excluded
  });
});
