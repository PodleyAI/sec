/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { parseEdgarHtml } from "../../../html/parseEdgarHtml";
import { S1_SECTIONS } from "./DocumentSegmenter";
import { DocumentTreeSegmenter } from "./DocumentTreeSegmenter";

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

  it("resolves the prospectus-summary section (SPAC profile source)", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">PROSPECTUS SUMMARY</p>
        <p>We are a blank check company focused on fintech in Latin America.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Directors and officers.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const sections = new DocumentTreeSegmenter().segment(doc);
    const byName = new Map(sections.map((s) => [s.name, s.text]));
    expect(byName.has(S1_SECTIONS.PROSPECTUS_SUMMARY)).toBe(true);
    expect(byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY)).toContain(
      "blank check company focused on fintech in Latin America"
    );
    // The tight anchoring must not swallow the following Management section.
    expect(byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY)).not.toContain("Directors and officers.");
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

  it("rescues a compensation section nested as a plain line inside MANAGEMENT", () => {
    // Churchill Capital Corp XII's shape: the Item 402 disclosure is a bolded
    // line inside MANAGEMENT, never its own structural heading, so the tree
    // walk found nothing and the caller recorded SECTION_NOT_FOUND — a
    // heading-coverage alarm on a heading the patterns already match.
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Michael Klein has served as our Chief Executive Officer since inception.</p>
        <p style="font-weight:700">Officer and Director Compensation</p>
        <p>None of our executive officers or directors have received any cash compensation.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const byName = new Map(new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text]));
    expect(byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION)).toContain(
      "None of our executive officers or directors have received any cash compensation"
    );
    // The container keeps its own full body.
    expect(byName.get(S1_SECTIONS.MANAGEMENT)).toContain("Michael Klein");
  });

  it("prefers a real compensation SectionNode over a nested slice", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Officer and Director Compensation</p>
        <p>Nested copy.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">EXECUTIVE COMPENSATION</p>
        <p>Structural copy.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const byName = new Map(new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text]));
    expect(byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION)).toContain("Structural copy");
    expect(byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION)).not.toContain("Nested copy");
  });

  it("leaves the target absent when the container has no such heading", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Directors and officers, with no compensation disclosure at all.</p>
      </body></html>`;
    const doc = parseEdgarHtml(html, "S-1");
    const byName = new Map(new DocumentTreeSegmenter().segment(doc).map((s) => [s.name, s.text]));
    expect(byName.has(S1_SECTIONS.EXECUTIVE_COMPENSATION)).toBe(false);
  });
});
