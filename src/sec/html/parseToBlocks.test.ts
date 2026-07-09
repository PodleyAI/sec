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
});
