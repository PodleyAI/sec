/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { Form_CFPORTAL } from "./Form_CFPORTAL";

const FIXTURE_DIR = join(__dirname, "mock_data", "cfportal");

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith("-primary_doc.xml"))
    .sort();
}

describe("Form_CFPORTAL parser", () => {
  it("has fixtures to parse", () => {
    expect(fixtureFiles().length).toBeGreaterThan(0);
  });

  it("parses every fixture and extracts the portal identity", async () => {
    for (const file of fixtureFiles()) {
      const xml = readFileSync(join(FIXTURE_DIR, file), "utf-8");
      const parsed = await Form_CFPORTAL.parse("CFPORTAL", xml);
      expect(["CFPORTAL", "CFPORTAL/A", "CFPORTAL-W"]).toContain(parsed.headerData.submissionType);
      expect(parsed.headerData.filerInfo.filer.filerCredentials.filerCik).toMatch(/^\d+$/);
      if (parsed.headerData.submissionType !== "CFPORTAL-W") {
        expect(parsed.formData?.identifyingInformation?.nameOfPortal).toBeTruthy();
      }
    }
  });

  it("rejects unknown form codes", async () => {
    await expect(Form_CFPORTAL.parse("CFPORTAL-X" as any, "<xml/>")).rejects.toThrow(
      "Invalid form"
    );
  });
});
