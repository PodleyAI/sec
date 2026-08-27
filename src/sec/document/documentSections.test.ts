/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { NodeKind, renderMarkdown } from "workglow";
import type { DocumentNode, DocumentRootNode, ParagraphNode, SectionNode } from "workglow";
import { joinDocumentSections, splitDocumentSections } from "./documentSections";

let nextId = 0;
const para = (text: string): ParagraphNode => ({
  nodeId: `p${nextId++}`,
  kind: NodeKind.PARAGRAPH,
  range: { startOffset: 0, endOffset: text.length },
  text,
});

const section = (title: string, level: number, children: DocumentNode[]): SectionNode => ({
  nodeId: `s${nextId++}`,
  kind: NodeKind.SECTION,
  range: { startOffset: 0, endOffset: 0 },
  text: title,
  level,
  title,
  children,
});

const doc = (title: string, children: DocumentNode[]): DocumentRootNode => ({
  nodeId: "root",
  kind: NodeKind.DOCUMENT,
  range: { startOffset: 0, endOffset: 0 },
  text: "",
  title,
  children,
});

describe("splitDocumentSections", () => {
  it("keeps the preamble ahead of the first heading as ordinal 0", () => {
    const slices = splitDocumentSections(
      doc("S-1 0001", [para("Cover page prose."), section("Risk Factors", 1, [para("Risk.")])])
    );
    expect(slices.map((s) => [s.ordinal, s.title, s.depth])).toEqual([
      [0, "S-1 0001", 0],
      [1, "Risk Factors", 1],
    ]);
    expect(slices[0].markdown).toBe("Cover page prose.");
  });

  it("omits the preamble when nothing precedes the first heading", () => {
    const slices = splitDocumentSections(doc("S-1", [section("Summary", 1, [para("Body.")])]));
    expect(slices).toHaveLength(1);
    expect(slices[0].title).toBe("Summary");
  });

  it("gives a nested subsection its own slice rather than repeating it in the parent", () => {
    const slices = splitDocumentSections(
      doc("S-1", [
        section("Business", 1, [para("Intro."), section("Our Market", 2, [para("Market.")])]),
      ])
    );
    expect(slices.map((s) => s.title)).toEqual(["Business", "Our Market"]);
    // The parent carries its own prose and NOT the child's — the property that
    // keeps a long filing from being stored once per nesting level.
    expect(slices[0].markdown).toBe("# Business\n\nIntro.");
    expect(slices[0].markdown).not.toContain("Market.");
    expect(slices[1].markdown).toBe("## Our Market\n\nMarket.");
    expect(slices.map((s) => s.depth)).toEqual([1, 2]);
  });

  it("emits a heading with no body as its heading alone", () => {
    const slices = splitDocumentSections(
      doc("S-1", [section("Part II", 1, [section("Item 13", 2, [para("Body.")])])])
    );
    expect(slices[0].markdown).toBe("# Part II");
  });

  it("rebuilds the document exactly when the slices are concatenated", () => {
    const tree = doc("S-1", [
      para("Cover."),
      section("Business", 1, [para("Intro."), section("Market", 2, [para("Market prose.")])]),
      section("Risk Factors", 1, [para("Risks.")]),
    ]);
    expect(joinDocumentSections(splitDocumentSections(tree))).toBe(renderMarkdown(tree));
  });

  it("slugifies headings and disambiguates repeats within one filing", () => {
    const slices = splitDocumentSections(
      doc("S-1", [
        section("Risk Factors", 1, [para("a")]),
        section("Overview", 1, [para("b")]),
        section("Overview", 1, [para("c")]),
        section("Overview", 1, [para("d")]),
      ])
    );
    expect(slices.map((s) => s.slug)).toEqual([
      "risk-factors",
      "overview",
      "overview-2",
      "overview-3",
    ]);
  });

  it("falls back to an ordinal slug for a heading with no sluggable characters", () => {
    const slices = splitDocumentSections(doc("S-1", [section("— * —", 1, [para("a")])]));
    expect(slices[0].slug).toBe("section-0");
  });

  it("keeps slugs unique and within the storage width for very long headings", () => {
    const long = `${"Item 1A. ".repeat(20)}Risk Factors`;
    const slices = splitDocumentSections(
      doc("S-1", [section(long, 1, [para("a")]), section(long, 1, [para("b")])])
    );
    expect(slices[0].slug.length).toBeLessThanOrEqual(96);
    expect(slices[1].slug.length).toBeLessThanOrEqual(96);
    expect(slices[0].slug).not.toBe(slices[1].slug);
  });

  it("clamps a heading deeper than markdown allows to six hashes", () => {
    const slices = splitDocumentSections(doc("S-1", [section("Deep", 9, [para("a")])]));
    expect(slices[0].markdown.startsWith("###### Deep")).toBe(true);
    expect(slices[0].depth).toBe(6);
  });
});
