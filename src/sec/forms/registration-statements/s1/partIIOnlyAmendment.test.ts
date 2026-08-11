/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { looksLikePartIIOnlyAmendment } from "./partIIOnlyAmendment";

/** The shape of a real Part II-only amendment: cover, Part II items, signatures. */
const partIIOnly = `
  <html><body>
    <p>AMENDMENT NO. 1 TO FORM S-1 REGISTRATION STATEMENT</p>
    <p>WinVest Acquisition Corp.</p>
    <p>PART II — INFORMATION NOT REQUIRED IN PROSPECTUS</p>
    <p>Item 13. Other Expenses of Issuance and Distribution.</p>
    <p>Item 16. Exhibits and Financial Statement Schedules.</p>
    <p>SIGNATURES</p>
  </body></html>`;

describe("looksLikePartIIOnlyAmendment", () => {
  it("accepts an amendment with no prospectus body", () => {
    expect(looksLikePartIIOnlyAmendment(partIIOnly)).toBe(true);
  });

  it("rejects anything that mentions risk factors at all", () => {
    // The decisive case: a prospectus we FAILED to segment must still report its
    // failures rather than be waved through as having nothing to find.
    const unsegmentable = `${partIIOnly}<p>See the section titled Risk Factors on page 18.</p>`;
    expect(looksLikePartIIOnlyAmendment(unsegmentable)).toBe(false);
  });

  it("sees the phrase even when EDGAR markup splits it across tags", () => {
    expect(looksLikePartIIOnlyAmendment(`<p><b>Risk</b> <b>Factors</b></p>`)).toBe(false);
    expect(looksLikePartIIOnlyAmendment(`<p>Risk<br/>Factors</p>`)).toBe(false);
  });

  it("rejects a document long enough to hold a prospectus", () => {
    // Second, independent guard: length alone disqualifies, so a prospectus that
    // somehow never says "risk factors" is still triaged rather than skipped.
    const long = `<html><body><p>${"lorem ipsum ".repeat(20_000)}</p></body></html>`;
    expect(looksLikePartIIOnlyAmendment(long)).toBe(false);
  });

  it("does not count markup toward the length ceiling", () => {
    // A short document buried in verbose inline styles is still short.
    const styled = Array.from(
      { length: 2_000 },
      () => `<p style="font: bold 10pt Times New Roman, Times, Serif; margin: 0pt 0">x</p>`
    ).join("");
    expect(styled.length).toBeGreaterThan(120_000);
    expect(looksLikePartIIOnlyAmendment(styled)).toBe(true);
  });
});
