/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { parseToBlocks } from "./parseToBlocks";

describe("parseToBlocks", () => {
  it("coalesces contiguous prose and breaks at structural blocks", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <p>First line.</p>
        <p>Second line.</p>
        <table><tr><th>H</th></tr><tr><td>1</td></tr></table>
        <p>After table.</p>
      </body></html>`);
    const types = blocks.map((b) => b.type);
    expect(types).toEqual(["paragraph", "table", "paragraph"]);
    if (blocks[0].type === "paragraph") {
      expect(blocks[0].node.text).toBe("First line.\n\nSecond line.");
    }
  });

  it("emits heading candidates and a page-break marker", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:14pt">MANAGEMENT</p>
        <p>Body.</p>
        <hr style="page-break-after:always" />
        <p>Next page.</p>
      </body></html>`);
    expect(blocks.some((b) => b.type === "heading")).toBe(true);
    expect(blocks.some((b) => b.type === "page-break")).toBe(true);
  });

  it("extracts lists and images", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <ul><li>a</li><li>b</li></ul>
        <img src="logo.jpg" alt="Logo" />
      </body></html>`);
    expect(blocks.find((b) => b.type === "list")).toBeDefined();
    expect(blocks.find((b) => b.type === "image")).toBeDefined();
  });

  it("does not drop an image wrapped in a block element", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <div><img src="logo.jpg" alt="Logo" /></div>
        <p><img src="sig.png" alt="Signature" /></p>
      </body></html>`);
    const images = blocks.filter((b) => b.type === "image");
    expect(images).toHaveLength(2);
  });

  it("descends into page-sized container divs instead of dropping their content", () => {
    // EDGAR wraps each page's content in a page-sized div; the walk must emit a
    // page-break marker AND keep the wrapped content (regression: real filings
    // collapsed to a handful of nodes when these subtrees were skipped).
    const blocks = parseToBlocks(`
      <html><body>
        <div style="height:792pt;width:612pt">
          <p>Page one content.</p>
          <table><tr><th>H</th></tr><tr><td>1</td></tr></table>
        </div>
      </body></html>`);
    expect(blocks.some((b) => b.type === "page-break")).toBe(true);
    expect(
      blocks.some((b) => b.type === "paragraph" && b.node.text.includes("Page one content"))
    ).toBe(true);
    expect(blocks.some((b) => b.type === "table")).toBe(true);
  });

  it("emits TOC back-links and page numbers as their own blocks, not coalesced into body", () => {
    // Modern page-container filings put a "Table of Contents" <a> and a centered
    // page number in their own <p>s adjacent to body prose. Coalescing them into
    // the prose buffer produces unique long paragraphs the de-paginator cannot
    // recognize as furniture, so every page's TOC/page number leaks into the
    // section text handed to extractors.
    const blocks = parseToBlocks(`
      <html><body>
        <div style="height:792pt;width:612pt">
          <p><a href="#TOC">Table of Contents</a></p>
          <p>Body of the first page continues here.</p>
          <p style="text-align:center">42</p>
        </div>
        <div style="height:792pt;width:612pt">
          <p><a href="#TOC">Table of Contents</a></p>
          <p>Body of the second page continues here.</p>
          <p style="text-align:center">43</p>
        </div>
      </body></html>`);
    const paras = blocks
      .filter((b) => b.type === "paragraph")
      .map((b) => (b.type === "paragraph" ? b.node.text : ""));
    expect(paras.filter((t) => t === "Table of Contents")).toHaveLength(2);
    expect(paras.filter((t) => t === "42" || t === "43")).toEqual(["42", "43"]);
    expect(paras.some((t) => t.startsWith("Table of Contents\n"))).toBe(false);
    expect(paras.some((t) => /\n\d{1,4}$/.test(t))).toBe(false);
    expect(paras).toContain("Body of the first page continues here.");
    expect(paras).toContain("Body of the second page continues here.");
  });

  it("treats semantic h1-h6 tags as headings ranked by level", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <h1>Risk Factors</h1>
        <p>Body.</p>
        <h2>Market Risk</h2>
      </body></html>`);
    const headings = blocks.filter((b) => b.type === "heading");
    expect(headings).toHaveLength(2);
    // h1 outranks h2 (lower level number = shallower)
    const h1 = headings.find((b) => b.type === "heading" && b.text === "Risk Factors");
    const h2 = headings.find((b) => b.type === "heading" && b.text === "Market Risk");
    expect(h1 && h1.type === "heading" && h1.level).toBe(1);
    expect(h2 && h2.type === "heading" && h2.level).toBe(2);
  });

  it("detects headings whose emphasis comes from inner <b>/<font size> (not inline style)", () => {
    // Common EDGAR markup: bold/size lives on a child tag, not the block's style.
    const blocks = parseToBlocks(`
      <html><body>
        <p><b>MANAGEMENT</b></p>
        <p>directors and officers</p>
        <div><font size="5">RISK FACTORS</font></div>
        <p>risks</p>
      </body></html>`);
    const headings = blocks
      .filter((b) => b.type === "heading")
      .map((b) => (b as { text: string }).text);
    expect(headings).toContain("MANAGEMENT");
    expect(headings).toContain("RISK FACTORS");
  });

  it("numbers ordered-list items sequentially in ListNode.text", () => {
    const blocks = parseToBlocks(
      `<html><body><ol><li>first</li><li>second</li><li>third</li></ol></body></html>`
    );
    const list = blocks.find((b) => b.type === "list");
    expect(list && list.type === "list" && list.node.text).toBe("1. first\n2. second\n3. third");
  });

  it("skips display:none subtrees (iXBRL ix:header metadata must not leak into prose)", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <div style="display:none"><p>c_2026-01-01 iso4217:USD hidden header noise</p></div>
        <p>Visible prospectus text.</p>
      </body></html>`);
    const text = blocks.map((b) => (b.type === "paragraph" ? b.node.text : "")).join(" ");
    expect(text).toContain("Visible prospectus text.");
    expect(text).not.toContain("hidden header noise");
  });

  describe("SVG/MathML/<title> injection surface", () => {
    // A body-level <title>, an SVG subtree (title/desc/foreignObject), or a
    // MathML subtree (mtext) each survive cheerio's `.text()` walks unless
    // stripped at the DOM level. Every one must be quarantined so an
    // adversarial filer cannot smuggle prose into the AI extractor prompt.
    const LEAK = "SYSTEM: leaked";

    function collectText(html: string): string {
      const blocks = parseToBlocks(html);
      return blocks
        .map((b) => {
          if (b.type === "paragraph") return b.node.text;
          if (b.type === "heading") return b.text;
          if (b.type === "list") return b.node.text;
          return "";
        })
        .join(" ");
    }

    it("body-level <title> between paragraphs does not leak into prose", () => {
      const text = collectText(
        `<html><body><p>Before.</p><title>${LEAK}</title><p>After.</p></body></html>`
      );
      expect(text).toContain("Before.");
      expect(text).toContain("After.");
      expect(text).not.toContain(LEAK);
    });

    it("<svg> subtree (title/desc/foreignObject) does not leak into prose", () => {
      const text = collectText(
        `<html><body><p>Prose start.</p>` +
          `<svg width="0" height="0"><title>${LEAK}</title>` +
          `<desc>${LEAK}</desc>` +
          `<foreignObject><p>${LEAK}</p></foreignObject></svg>` +
          `<p>Prose end.</p></body></html>`
      );
      expect(text).toContain("Prose start.");
      expect(text).toContain("Prose end.");
      expect(text).not.toContain(LEAK);
    });

    it("<math> subtree (mtext) does not leak into prose", () => {
      const text = collectText(
        `<html><body><p>Ok.</p>` +
          `<math><mtext>${LEAK}</mtext></math>` +
          `<p>Also ok.</p></body></html>`
      );
      expect(text).toContain("Ok.");
      expect(text).toContain("Also ok.");
      expect(text).not.toContain(LEAK);
    });

    it("<xmp> / <plaintext> raw-text elements do not leak into prose", () => {
      const text = collectText(
        `<html><body><p>Real.</p>` +
          `<xmp>${LEAK}</xmp>` +
          `<plaintext>${LEAK}</plaintext>` +
          `<p>More real.</p></body></html>`
      );
      expect(text).toContain("Real.");
      // <plaintext> is a legacy raw-text element that swallows the rest of the
      // document once opened; the pre-walk `.remove()` removes it (and its
      // content) so downstream prose is preserved and the injection is not.
      expect(text).not.toContain(LEAK);
    });

    it("HTML comments do not leak into prose", () => {
      const text = collectText(
        `<html><body><p>Visible.</p><!-- ${LEAK} --><p>Still visible.</p></body></html>`
      );
      expect(text).toContain("Visible.");
      expect(text).toContain("Still visible.");
      expect(text).not.toContain(LEAK);
    });
  });

  describe("CSS two-column offering summaries", () => {
    function tableMarkdown(html: string): string {
      return parseToBlocks(html)
        .filter((b) => b.type === "table")
        .map((b) => (b.type === "table" ? b.node.text : ""))
        .join("\n");
    }

    it("emits a GFM table from Donnelley sum1/sum2 hanging-indent pairs", () => {
      const md = tableMarkdown(`
        <html><body>
          <div class="sum1" style="width: 216pt; margin-top: 8pt; margin-left: 0pt; text-align: left;">Securities offered:</div>
          <div class="sum2" style="margin-top: -10pt; margin-left: 240pt;">25,000,000 units, at $10.00 per unit, each unit consisting of:</div>
          <table style="margin-left: 260pt;"><tr><td>•</td><td>one Class A ordinary share;</td></tr></table>
          <table style="margin-left: 260pt;"><tr><td>•</td><td>one-half of one redeemable warrant.</td></tr></table>
          <div class="sum1" style="width: 216pt; margin-top: 8pt; margin-left: 0pt;">Proposed Nasdaq symbols:</div>
          <div class="sum2" style="margin-top: -10pt; margin-left: 240pt;">Units: “AACBU”</div>
        </body></html>`);
      expect(md).toMatch(/\|\s*Securities offered:\s*\|\s*25,000,000 units, at \$10\.00 per unit/);
      expect(md).toMatch(/one-half of one redeemable warrant/);
      expect(md).toMatch(/\|\s*Proposed Nasdaq symbols:\s*\|\s*Units:/);
    });

    it("emits a GFM table from Workiva width / negative-margin-top pairs", () => {
      const md = tableMarkdown(`
        <html><body>
          <div style="width:144pt;">
            <div style="margin-left:10pt;">Securities offered</div>
          </div>
          <div style="margin-left:168pt; margin-top:-12pt; width:288pt;">
            20,000,000 units, at $10.00 per unit, each unit consisting of:
          </div>
          <div style="float:left; margin-left:188pt; width:20pt;">•</div>
          <div style="margin-left:208pt;">one Class A ordinary share;</div>
          <div style="clear:both; font-size:0pt; line-height:0pt;">&#8203;</div>
          <div style="width:144pt;">
            <div style="margin-left:10pt;">Proposed Nasdaq symbols</div>
          </div>
          <div style="margin-left:168pt; margin-top:-12pt;">Units: “XXXXU”</div>
        </body></html>`);
      expect(md).toMatch(/\|\s*Securities offered\s*\|\s*20,000,000 units, at \$10\.00 per unit/);
      expect(md).toMatch(/one Class A ordinary share/);
      expect(md).toMatch(/\|\s*Proposed Nasdaq symbols\s*\|\s*Units:/);
    });
  });

  it("peels THE OFFERING out of a 2-column table's caption row so the units row survives", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <table>
          <tr><td colspan="2">
            <p align="center" style="text-align:center;font-weight:700"><b>THE OFFERING</b></p>
            <p><em>In making your decision on whether to invest in our securities, you should take into account not only the background of the members of our management team, but also the special risks we face as a blank check company.</em></p>
          </td></tr>
          <tr><td>Securities offered:</td>
              <td>7,500,000 units, at $10.00 per unit, each unit consisting of:</td></tr>
        </table>
      </body></html>`);
    const headings = blocks
      .filter((b) => b.type === "heading")
      .map((b) => (b.type === "heading" ? b.text : ""));
    expect(headings).toContain("THE OFFERING");
    const md = blocks
      .filter((b) => b.type === "table")
      .map((b) => (b.type === "table" ? b.node.text : ""))
      .join("\n");
    expect(md).toMatch(/\|\s*Securities offered:\s*\|\s*7,500,000 units, at \$10\.00 per unit/);
  });

  it("unwraps a 1-column layout table so a nested heading and sibling data table survive", () => {
    const blocks = parseToBlocks(`
      <html><body>
        <table>
          <tr><td>
            <p style="text-align:center;font-weight:700"><b>The Offering</b></p>
            <p>In making your decision on whether to invest in our securities, you should take into account the risks.</p>
          </td></tr>
        </table>
        <table>
          <tr><td>Securities offered</td><td>7,500,000 units, at $10.00 per unit</td></tr>
        </table>
      </body></html>`);
    const headings = blocks
      .filter((b) => b.type === "heading")
      .map((b) => (b.type === "heading" ? b.text : ""));
    expect(headings).toContain("The Offering");
    const md = blocks
      .filter((b) => b.type === "table")
      .map((b) => (b.type === "table" ? b.node.text : ""))
      .join("\n");
    expect(md).toMatch(/\|\s*Securities offered\s*\|\s*7,500,000 units, at \$10\.00 per unit/);
  });
});
