/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "bun:test";
import { parseEdgarHtml } from "../../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./DocumentTreeSegmenter";
import { S1_SECTIONS } from "./DocumentSegmenter";

describe("DocumentTreeSegmenter", () => {
  it("resolves target sections from the tree and renders their bodies", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Directors and officers.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">PRINCIPAL AND SELLING STOCKHOLDERS</p>
        <table><tr><th>Name</th><th>Shares</th></tr><tr><td>Alice</td><td>1,000</td></tr></table>
        <p style="font-weight:700;text-align:center;font-size:16pt">CERTAIN RELATIONSHIPS AND RELATED TRANSACTIONS</p>
        <p>We entered into agreements with related parties.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const sections = new DocumentTreeSegmenter().segment(doc);
    const byName = new Map(sections.map((s) => [s.name, s.text]));

    expect(byName.has(S1_SECTIONS.MANAGEMENT)).toBe(true);
    expect(byName.get(S1_SECTIONS.MANAGEMENT)).toContain("Directors and officers.");
    expect(byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP)).toContain("| Name | Shares |");
    expect(byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP)).toContain("Alice");
    expect(byName.has(S1_SECTIONS.RELATED_PARTY)).toBe(true);
  });

  it("keeps the section with the most body when a heading appears twice (TOC stub)", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;font-size:14pt">Management</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Real management body text here.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const sections = new DocumentTreeSegmenter().segment(doc);
    const mgmt = sections.filter((s) => s.name === S1_SECTIONS.MANAGEMENT);
    expect(mgmt).toHaveLength(1);
    expect(mgmt[0].text).toContain("Real management body text here.");
  });

  it("does not emit a matched section whose body is empty (-> caller records NOT_FOUND)", () => {
    // A target heading with no following content must not yield an empty Section
    // (which would be sent to the AI as an empty prompt).
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">RISK FACTORS</p>
        <p>not a target section body</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const sections = new DocumentTreeSegmenter().segment(doc);
    expect(sections.some((s) => s.name === S1_SECTIONS.MANAGEMENT)).toBe(false);
  });

  it("resolves the four new offering sections from the tree", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">THE OFFERING</p>
        <p>We are offering 5,000,000 shares.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">USE OF PROCEEDS</p>
        <p>We intend to use the net proceeds for working capital.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">UNDERWRITING</p>
        <p>Goldman Sachs &amp; Co. LLC is acting as representative.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">THE SPONSOR</p>
        <p>Our sponsor is Acme Sponsor, LLC.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const byName = new Map(new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text]));
    expect(byName.get(S1_SECTIONS.THE_OFFERING)).toContain("5,000,000 shares");
    expect(byName.get(S1_SECTIONS.USE_OF_PROCEEDS)).toContain("working capital");
    expect(byName.get(S1_SECTIONS.UNDERWRITING)).toContain("Goldman Sachs");
    expect(byName.get(S1_SECTIONS.THE_SPONSOR)).toContain("Acme Sponsor");
  });
});
