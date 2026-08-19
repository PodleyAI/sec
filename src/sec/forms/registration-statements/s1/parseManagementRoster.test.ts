/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { parseManagementRoster } from "./parseManagementRoster";

const ROSTER = [
  "Directors and Executive Officers",
  "| Name | Age | Title |",
  "| --- | --- | --- |",
  "| Ally Tong Zhang | 52 | Chairwoman, Director and Chief Executive Officer |",
  "| Xin Wang | 36 | Chief Financial Officer |",
  "| Hongmei Zhao | 45 | Director |",
  "| [·] |  |  |",
  "| All officers and directors as a group |  |  |",
].join("\n");

const COMMITTEE = [
  "| Name | Age | Title |",
  "| Michael Klein | 62 | Chief Executive Officer, President and Chairman of the Board |",
  "| Jay Taragin | 60 | Chief Financial Officer |",
  "| · | the appointment, compensation, retention, replacement, |",
].join("\n");

const COMBINED = [
  "| Name and Position | Age | Principal Occupation |",
  "| Martin J. Shen President, CEO & Director | 56 | CEO of FingerMotion |",
].join("\n");

const NAME_ONLY = ["| Name |", "| Lawrence James Lawson III |", "| Robert T. Brown |"].join("\n");

const COLSPAN_AGE = [
  "| Name | Age | Age | Age |",
  "| Frank R. Martire, Jr. |  | 72 | Founder and Chairman of the Board |",
  "| Tanmay Kumar |  | 32 | Chief Financial Officer |",
].join("\n");

const EMPTY_AGE = [
  "| Name | Age | Position |",
  "| Thomas Sullivan |  | Chairman of the Board |",
  "| Kevin Charlton |  | Chief Executive Officer |",
].join("\n");

describe("parseManagementRoster", () => {
  it("never throws", () => {
    expect(parseManagementRoster("")).toEqual([]);
    expect(parseManagementRoster("|  |")).toEqual([]);
  });

  it("reads Name/Age/Title rows, canonicalizes titles, and drops placeholders", () => {
    const rows = parseManagementRoster(ROSTER);
    expect(rows.map((r) => [r.full_name, r.age, r.titles])).toEqual([
      ["Ally Tong Zhang", 52, ["Chairwoman of the Board of Directors", "Chief Executive Officer"]],
      ["Xin Wang", 36, ["Chief Financial Officer"]],
      ["Hongmei Zhao", 45, ["Director"]],
    ]);
    expect(rows.every((r) => r.source === "deterministic")).toBe(true);
  });

  it("skips committee-charter bullets under a roster header", () => {
    const rows = parseManagementRoster(COMMITTEE);
    expect(rows.map((r) => r.full_name)).toEqual(["Michael Klein", "Jay Taragin"]);
  });

  it("splits a combined Name and Position first cell", () => {
    const rows = parseManagementRoster(COMBINED);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.full_name).toBe("Martin J. Shen");
    expect(rows[0]!.titles).toEqual(["President", "CEO", "Director"]);
  });

  it("does not hit a Name-only wreck", () => {
    expect(parseManagementRoster(NAME_ONLY)).toEqual([]);
  });

  it("reads a colspan-repeated Age header with the title in the last cell", () => {
    const rows = parseManagementRoster(COLSPAN_AGE);
    expect(rows.map((r) => [r.full_name, r.age, r.titles])).toEqual([
      ["Frank R. Martire, Jr.", 72, ["Founder and Chairman of the Board of Directors"]],
      ["Tanmay Kumar", 32, ["Chief Financial Officer"]],
    ]);
  });

  it("reads Name/Age/Position rows whose age cell is blank", () => {
    const rows = parseManagementRoster(EMPTY_AGE);
    expect(rows.map((r) => [r.full_name, r.age, r.titles])).toEqual([
      ["Thomas Sullivan", null, ["Chairman of the Board of Directors"]],
      ["Kevin Charlton", null, ["Chief Executive Officer"]],
    ]);
  });
});
