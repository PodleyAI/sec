import { describe, expect, it } from "vitest";
import { inferFormatChoices } from "./formatChoices";

describe("inferFormatChoices", () => {
  it("reads each shape sec's commands actually declare", () => {
    expect(inferFormatChoices("Output format (table, json, csv)", "table")).toEqual([
      "table",
      "json",
      "csv",
    ]);
    expect(inferFormatChoices("Output format (table, json)", "table")).toEqual(["table", "json"]);
    expect(inferFormatChoices("output format: text | json", "text")).toEqual(["text", "json"]);
    expect(inferFormatChoices("output format: text | tsv", "text")).toEqual(["text", "tsv"]);
    expect(inferFormatChoices("output format: table | csv | json", "table")).toEqual([
      "table",
      "csv",
      "json",
    ]);
    // The default is stated in prose rather than as a commander default.
    expect(inferFormatChoices("table | json (default: table)", undefined)).toEqual([
      "table",
      "json",
    ]);
  });

  it("declines rather than offering a list the command's default is not in", () => {
    // The exact failure a single stated vocabulary produced.
    expect(inferFormatChoices("Output format (table, json, csv)", "text")).toBeUndefined();
  });

  it("declines a description that states no vocabulary", () => {
    expect(inferFormatChoices("Output format", "table")).toBeUndefined();
    expect(inferFormatChoices("How to render the result", undefined)).toBeUndefined();
    // A prose clause is not a list, however many commas it has.
    expect(
      inferFormatChoices("Output format, which controls how rows are rendered", undefined)
    ).toBeUndefined();
  });
});
