/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Form_F_1 } from "./Form_F_1";
import { Form_F_1MEF } from "./Form_F_1MEF";

const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

const FIXTURE = path.join(
  importMetaDir,
  "../../html/mock_data/s1/f1_2000001_000000000026000777.txt"
);

describe("Form_F_1 / Form_F_1MEF", () => {
  it("declares the foreign-issuer registration form symbols", () => {
    expect(Form_F_1.forms).toEqual(["F-1", "F-1/A"]);
    expect(Form_F_1MEF.forms).toEqual(["F-1MEF"]);
  });

  it("parse() reads the foreign-issuer SGML header (SIC 6770) and primary F-1 document", async () => {
    const txt = readFileSync(FIXTURE, "utf-8");
    const parsed = await Form_F_1.parse("F-1", txt);
    expect(parsed.header.sic).toBe(6770);
    expect(parsed.header.sicDescription).toBe("BLANK CHECKS");
    expect(parsed.header.cik).toBe(2000001);
    expect(parsed.html).toContain("MANAGEMENT");
    expect(parsed.html).toContain("Synthetic Cayman Sponsor, LLC");
    expect(parsed.html).not.toContain("auditor consent"); // exhibit excluded
  });

  it("Form_F_1MEF.parse() delegates to the shared submission parser", async () => {
    const txt = readFileSync(FIXTURE, "utf-8").replace(/<TYPE>F-1\b/g, "<TYPE>F-1MEF");
    const parsed = await Form_F_1MEF.parse("F-1MEF", txt);
    expect(parsed.header.sic).toBe(6770);
    expect(parsed.html).toContain("MANAGEMENT");
  });
});
