/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { trimManagementSectionText } from "./trimManagementSection";

const rosterAndBios = [
  "| Name | Age | Position |",
  "| Jane Roe | 54 | Chief Executive Officer |",
  "",
  "Jane Roe has served as our Chief Executive Officer since 2020.",
  "She previously was a partner at Example Capital.",
].join("\n");

const fluff = [
  "Director Independence",
  "",
  "Nasdaq rules require that a majority of our board be independent.",
  "",
  "Audit Committee",
  "",
  "Our audit committee will be responsible for, among other things,",
  "approving the independent auditors.",
].join("\n");

describe("trimManagementSectionText", () => {
  it("keeps roster and bios; drops governance fluff at the stop heading", () => {
    const input = `${rosterAndBios}\n\n${fluff}`;
    const out = trimManagementSectionText(input);
    expect(out).toContain("Jane Roe has served");
    expect(out).not.toContain("Audit Committee");
    expect(out).not.toContain("Nasdaq rules require");
    expect(out.endsWith("Example Capital.")).toBe(true);
  });

  it("returns text unchanged when no stop heading is present", () => {
    expect(trimManagementSectionText(rosterAndBios)).toBe(rosterAndBios);
  });

  it("ignores a stop heading in the first 8% of the section", () => {
    const early = "Audit Committee\n\n" + "x".repeat(5000);
    const late = `\n\nDirector Independence\n\nmore fluff`;
    const input = early + late;
    const out = trimManagementSectionText(input);
    expect(out.startsWith("Audit Committee")).toBe(true);
    expect(out).not.toContain("more fluff");
    expect(out).toContain("x".repeat(100));
  });

  it("cuts at the earliest matching stop heading", () => {
    const input = [
      rosterAndBios,
      "",
      "Family Relationships",
      "",
      "There are no family relationships.",
      "",
      "Audit Committee",
      "",
      "Approve auditors.",
    ].join("\n");
    const out = trimManagementSectionText(input);
    expect(out).toContain("Jane Roe has served");
    expect(out).not.toContain("There are no family relationships");
    expect(out).not.toContain("Approve auditors");
  });
});
