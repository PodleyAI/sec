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

  describe("a section that has swallowed another", () => {
    // A converter that reads an all-caps heading as a higher level than the
    // sentence-case ones after it nests the rest of the prospectus beneath it.
    const swallowed = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:18pt">RISK FACTORS</p>
        <p>Our business faces the following risks, which are material.</p>
        <p style="font-weight:700;font-size:13pt">Use of proceeds</p>
        <p>We will place the net proceeds in the trust account.</p>
        <p style="font-weight:700;font-size:13pt">Underwriting</p>
        <p>The underwriters have agreed to purchase the units.</p>
      </body></html>`;

    it("stops the container where the nested section begins", () => {
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(swallowed, "S-1"));
      const byName = new Map(sections.map((s) => [s.name, s.text]));
      const risks = byName.get(S1_SECTIONS.RISK_FACTORS) ?? "";
      expect(risks).toContain("material");
      expect(risks).not.toContain("trust account");
      expect(risks).not.toContain("agreed to purchase");
    });

    it("still resolves the swallowed sections in their own right", () => {
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(swallowed, "S-1"));
      const byName = new Map(sections.map((s) => [s.name, s.text]));
      expect(byName.get(S1_SECTIONS.USE_OF_PROCEEDS)).toContain("trust account");
      expect(byName.get(S1_SECTIONS.UNDERWRITING)).toContain("agreed to purchase");
    });

    it("leaves a containment a prospectus really has", () => {
      // A summary carrying the offering table is not a swallow, and cutting
      // there would leave a stub instead of a summary.
      const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:18pt">SUMMARY</p>
        <p>We are a blank check company newly incorporated in Delaware.</p>
        <p style="font-weight:700;font-size:13pt">The offering</p>
        <p>We are offering 20,000,000 units at $10.00 per unit.</p>
        <p style="font-weight:700;font-size:13pt">Corporate information</p>
        <p>Our executive offices are located at 123 Main Street.</p>
      </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      const summary = sections.find((s) => s.name === S1_SECTIONS.PROSPECTUS_SUMMARY)?.text ?? "";
      expect(summary).toContain("blank check company");
      expect(summary).toContain("123 Main Street");
    });
  });

  describe("line-scan fallback", () => {
    // A converter can produce text with no structure: an InDesign export
    // typesets the prospectus inside hundreds of tables, so the tree carries
    // paragraphs and tables but almost no headings.
    // Padded past MIN_DOC_CHARS_FOR_LINE_SCAN: the fallback only fires on a
    // document big enough for "no structure" to be a converter failure rather
    // than simply a short filing.
    const filler = `<table><tr><td><p>${"Risk disclosure prose. ".repeat(40)}</p></td></tr></table>`;
    const noHeadingMarkup = `
      <html><body>
        <table><tr><td><p>Summary</p></td></tr></table>
        <table><tr><td><p>We are a blank check company incorporated in Delaware.</p></td></tr></table>
        ${filler.repeat(60)}
        <table><tr><td><p>Management</p></td></tr></table>
        <table><tr><td><p>Our officers and directors are listed below.</p></td></tr></table>
        <table><tr><td><p>Underwriting</p></td></tr></table>
        <table><tr><td><p>The underwriters have agreed to purchase the units.</p></td></tr></table>
      </body></html>`;

    it("recovers sections the tree walk could not see", () => {
      const result = new DocumentTreeSegmenter().segmentDocument(
        parseEdgarHtml(noHeadingMarkup, "S-1")
      );
      expect(result.usedLineScan).toBe(true);
      const byName = new Map(result.sections.map((s) => [s.name, s.text]));
      expect(byName.get(S1_SECTIONS.MANAGEMENT)).toContain("officers and directors");
      expect(byName.get(S1_SECTIONS.UNDERWRITING)).toContain("agreed to purchase");
    });

    it("stays out of the way when the tree works", () => {
      const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Directors and officers.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">UNDERWRITING</p>
        <p>The underwriters have agreed to purchase the units.</p>
      </body></html>`;
      const result = new DocumentTreeSegmenter().segmentDocument(parseEdgarHtml(html, "S-1"));
      expect(result.usedLineScan).toBe(false);
    });
  });

  it("recovers an offering block the filer bolded inside the summary", () => {
    // Same shape as the Item 402 disclosure nested in MANAGEMENT: the line is a
    // bolded paragraph, not a heading, so the tree walk never sees it and the
    // offering-terms extractor gets nothing.
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">PROSPECTUS SUMMARY</p>
        <p>We are a blank check company incorporated in the Cayman Islands.</p>
        <p><b>The Offering</b></p>
        <p>We are offering 20,000,000 units at $10.00 per unit, each unit consisting
           of one Class A ordinary share and one-half of one redeemable warrant.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">RISK FACTORS</p>
        <p>Our business faces the following risks.</p>
      </body></html>`;
    const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
    const byName = new Map(sections.map((s) => [s.name, s.text]));
    expect(byName.get(S1_SECTIONS.THE_OFFERING)).toContain("$10.00 per unit");
    // The summary keeps it too — a summary really does carry its offering table,
    // which is why LEGITIMATE_CONTAINMENTS does not truncate there.
    expect(byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY)).toContain("blank check company");
  });

  it("prefers a real offering section over the one nested in the summary", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">PROSPECTUS SUMMARY</p>
        <p>We are a blank check company.</p>
        <p><b>The Offering</b></p>
        <p>Summary offering blurb.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">THE OFFERING</p>
        <p>The full offering table with every unit term stated at length.</p>
      </body></html>`;
    const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
    const offering = sections.find((s) => s.name === S1_SECTIONS.THE_OFFERING)?.text ?? "";
    expect(offering).toContain("every unit term");
  });

  it("recovers an ownership table that follows the roster unheaded", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Our officers and directors are listed below.</p>
        <p><b>Principal stockholders</b></p>
        <p>The following table sets forth information regarding beneficial ownership
           of our shares by each person known to own more than 5%.</p>
        <p style="font-weight:700;text-align:center;font-size:16pt">UNDERWRITING</p>
        <p>The underwriters have agreed to purchase the units.</p>
      </body></html>`;
    const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
    const byName = new Map(sections.map((s) => [s.name, s.text]));
    expect(byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP)).toContain("more than 5%");
    expect(byName.get(S1_SECTIONS.MANAGEMENT)).toContain("officers and directors");
  });

  describe("a heading a converter fused a page marker onto", () => {
    // `BurTech Acquisition Corp.` renders `PRINCIPAL STOCKHOLDERS3`, the
    // anchor's superscript glued on, and the whole ownership table was lost.
    it("matches through the trailing marker", () => {
      const html = `
        <html><body>
          <p style="font-weight:700;text-align:center;font-size:16pt">PRINCIPAL STOCKHOLDERS3</p>
          <p>The following table sets forth beneficial ownership of our shares.</p>
        </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      const owners = sections.find((s) => s.name === S1_SECTIONS.BENEFICIAL_OWNERSHIP)?.text ?? "";
      expect(owners).toContain("beneficial ownership");
    });

    it("does not let the marker change an unambiguous heading", () => {
      // The heading as printed matches, so the trimmed retry never runs.
      const html = `
        <html><body>
          <p style="font-weight:700;text-align:center;font-size:16pt">USE OF PROCEEDS</p>
          <p>We will receive gross proceeds of $100,000,000.</p>
        </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      expect(sections.find((s) => s.name === S1_SECTIONS.USE_OF_PROCEEDS)?.text).toContain(
        "gross proceeds"
      );
    });
  });

  describe("the nesting fallback is general, minus the restating container", () => {
    // A pair nothing declares: `Harvard Ave Acquistion Corp` (CIK 2042460) bolds
    // its sponsor block inside MANAGEMENT, which no list of (target, container)
    // pairs written from the corpus would have predicted.
    it("recovers a target from a container no declared pair names", () => {
      const html = `
        <html><body>
          <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
          <p>Our officers and directors are listed below.</p>
          <p><b>Our Sponsor</b></p>
          <p>Our sponsor, Copley Square Sponsor Limited, is a Cayman Islands exempted
             company holding 6,967,500 insider shares.</p>
          <p style="font-weight:700;text-align:center;font-size:16pt">UNDERWRITING</p>
          <p>The underwriters have agreed to purchase the units.</p>
        </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      const byName = new Map(sections.map((s) => [s.name, s.text]));
      expect(byName.get(S1_SECTIONS.THE_SPONSOR)).toContain("Copley Square Sponsor Limited");
      expect(byName.get(S1_SECTIONS.MANAGEMENT)).toContain("officers and directors");
    });

    // The summary names every section of the prospectus, so a heading-shaped
    // line in it is a cross-reference. Reading it as a block donated a 208k
    // "The Sponsor" carved out of a 217k summary on real filings.
    it("never donates a section out of the prospectus summary", () => {
      const html = `
        <html><body>
          <p style="font-weight:700;text-align:center;font-size:16pt">PROSPECTUS SUMMARY</p>
          <p>We are a blank check company.</p>
          <p><b>Our Sponsor</b></p>
          <p>Our sponsor is an affiliate of our chief executive officer.</p>
          <p style="font-weight:700;text-align:center;font-size:16pt">UNDERWRITING</p>
          <p>The underwriters have agreed to purchase the units.</p>
        </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      expect(sections.some((s) => s.name === S1_SECTIONS.THE_SPONSOR)).toBe(false);
    });

    // The one declared exception to the rule above, and the reason the declared
    // list still exists.
    it("still recovers the offering table declared inside the summary", () => {
      const html = `
        <html><body>
          <p style="font-weight:700;text-align:center;font-size:16pt">PROSPECTUS SUMMARY</p>
          <p>We are a blank check company.</p>
          <p><b>The Offering</b></p>
          <p>Each unit consists of one share and one-half of one redeemable warrant.</p>
          <p style="font-weight:700;text-align:center;font-size:16pt">UNDERWRITING</p>
          <p>The underwriters have agreed to purchase the units.</p>
        </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      const offering = sections.find((s) => s.name === S1_SECTIONS.THE_OFFERING)?.text ?? "";
      expect(offering).toContain("one-half of one redeemable warrant");
    });

    // Both bodies carry the line (MANAGEMENT ⊃ the resolved Item 402 block is a
    // legitimate containment), and the inner one bounds the slice to the block
    // that really encloses it.
    it("prefers the tightest enclosing container", () => {
      const html = `
        <html><body>
          <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
          <p>Our officers and directors are listed below.</p>
          <p style="font-weight:700;font-size:14pt">Executive Compensation</p>
          <p>No compensation has been paid.</p>
          <p><b>Our Sponsor</b></p>
          <p>Our sponsor holds the founder shares.</p>
        </body></html>`;
      const sections = new DocumentTreeSegmenter().segment(parseEdgarHtml(html, "S-1"));
      const sponsor = sections.find((s) => s.name === S1_SECTIONS.THE_SPONSOR)?.text ?? "";
      expect(sponsor).toContain("founder shares");
      expect(sponsor).not.toContain("officers and directors");
    });
  });
});
