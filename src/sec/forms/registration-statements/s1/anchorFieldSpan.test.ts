/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorFieldSpan, numericSurfaceForms, surfaceForms } from "./anchorFieldSpan";
import { DocumentTreeSegmenter } from "./DocumentTreeSegmenter";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { parseEdgarHtml } from "../../../html/parseEdgarHtml";

describe("numericSurfaceForms", () => {
  it("covers the ways a filing writes a large integer", () => {
    const forms = numericSurfaceForms(30_000_000);
    expect(forms).toContain("30000000");
    expect(forms).toContain("30,000,000");
  });

  it("covers dollar-style two-decimal rendering", () => {
    // The filing says "$10.00"; the model reports 10.
    expect(numericSurfaceForms(10)).toContain("10.00");
  });

  it("emits both readings of a percentage", () => {
    // A model may report 25% as 0.25 or 25 — the filing says "25%".
    expect(numericSurfaceForms(0.25)).toContain("25");
    expect(numericSurfaceForms(25)).toContain("0.25");
  });

  it("ignores non-finite values", () => {
    expect(numericSurfaceForms(Number.NaN)).toEqual([]);
    expect(numericSurfaceForms(Number.POSITIVE_INFINITY)).toEqual([]);
  });
});

describe("surfaceForms", () => {
  it("passes through a substantial string but not a trivial one", () => {
    expect(surfaceForms("Nasdaq")).toEqual(["Nasdaq"]);
    expect(surfaceForms("a")).toEqual([]);
    expect(surfaceForms(null)).toEqual([]);
  });
});

describe("anchorFieldSpan", () => {
  it("returns null for a value the text does not contain — the hallucination signal", () => {
    // This is the check a model-supplied span cannot make: today a fabricated
    // figure passes as long as some unrelated sentence verifies.
    expect(anchorFieldSpan("Founder shares | 11,500,000", 99_999_999)).toBeNull();
  });

  it("prefers the occurrence nearest the field's own label", () => {
    // A bare 10 appears everywhere in a prospectus; without the label the
    // citation would be whichever came first.
    const text =
      "The offering is 10 units in aggregate. ".repeat(6) +
      "Trust per public share | 10 | as described above.";
    const span = anchorFieldSpan(text, 10, "trust per public share");
    expect(span).toContain("trust per public share");
  });

  it("falls back to a plain match when the label is absent", () => {
    const span = anchorFieldSpan("Founder shares | 11,500,000 |", 11_500_000, "nowhere in here");
    expect(span).toContain("11,500,000");
  });
});

/** The Churchill Capital Corp XII prospectus — the filing this work came from. */
function churchillOfferingText(): string {
  const dir = fileURLToPath(new URL("../../../html/mock_data/s1", import.meta.url));
  const file = join(dir, "s1_2114227_000121390026039320.htm");
  const doc = parseEdgarHtml(readFileSync(file, "utf8"), file);
  const byName = new Map(new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text]));
  return [
    byName.get(S1_SECTIONS.THE_OFFERING),
    byName.get(S1_SECTIONS.THE_SPONSOR),
    byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY),
  ]
    .filter((t): t is string => typeof t === "string")
    .join("\n\n");
}

describe("anchorFieldSpan against the real Churchill XII prospectus", () => {
  const text = churchillOfferingText();

  // Figures the prospectus actually states in the text sponsor-promote is given.
  it.each([
    ["founder_shares", 11_500_000, "founder shares"],
    ["private_placement_warrants", 35_000, "private placement warrants"],
    ["trust_per_public_share", 10, "trust account"],
    ["units_offered", 30_000_000, "securities offered"],
  ])("anchors %s to a passage containing the value", (field, value, label) => {
    const span = anchorFieldSpan(text, value, label);
    expect(span, `${field} should be locatable`).not.toBeNull();
    // A real passage from the section...
    const flat = text.toLowerCase().replace(/\s+/g, " ");
    expect(flat).toContain(span!.slice(0, 40).replace(/\s+/g, " "));
    // ...that actually contains the value it claims to cite. This is the
    // invariant that matters: a citation not containing its own figure is
    // decorative, which is exactly what the inherited object-level spans were.
    const found = numericSurfaceForms(value as number).some((form) =>
      span!.toLowerCase().includes(form.toLowerCase())
    );
    expect(found, `${field}: citation should contain the value`).toBe(true);
  });

  it("picks the occurrence beside the field's label, not the first in the section", () => {
    // "30,000,000" appears nine times in this text. The citation has to be the
    // one in the offering table, not whichever came first.
    const span = anchorFieldSpan(text, 30_000_000, "securities offered");
    expect(span).toContain("securities offered | 30,000,000 units");
  });

  /**
   * The finding that justifies this whole approach.
   *
   * A live run reported `trust_total: 300000000` and
   * `over_allotment_units: 4500000` for sponsor-promote. NEITHER appears in the
   * text that extractor is given: the trust total is derived (30,000,000 units
   * × $10) and 4,500,000 is stated only in the Underwriting section, which this
   * extractor never sees — the promote text mentions the over-allotment option
   * nineteen times without ever giving the number.
   *
   * Both are arithmetically defensible, and both are inferences presented as
   * extractions. The object-level span check cannot see the difference, because
   * some other sentence always verifies. Anchoring can: a value absent from the
   * text it was supposedly read from gets no citation, and the field is flagged
   * rather than silently carrying a quote about something else.
   */
  it.each([
    ["trust_total (derived: 30,000,000 x $10)", 300_000_000, "trust account"],
    ["over_allotment_units (stated only in Underwriting)", 4_500_000, "over-allotment"],
  ])("declines to cite %s, which the section never states", (_label, value, label) => {
    expect(anchorFieldSpan(text, value, label)).toBeNull();
  });

  it("does not locate a figure the prospectus never states at all", () => {
    expect(anchorFieldSpan(text, 777_777_777, "founder shares")).toBeNull();
  });
});
