/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeKind, traverseDepthFirst } from "workglow";
import { DocumentTreeSegmenter } from "../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtmlWithTrace } from "../sec/html/parseEdgarHtml";
import { S1_SECTIONS } from "../sec/html/sectionVocabulary";
import { subtreeSourceSpan } from "../sec/html/sourceSpanIndex";
import { buildChunkTrace } from "./chunkTrace";
import { buildSectionTrace, isExpectedContainment } from "./sectionTrace";

const fixtureRoot = join(import.meta.dirname, "../sec/html/mock_data/s1");

function trace(name: string) {
  const html = readFileSync(join(fixtureRoot, name), "utf8");
  const parsed = parseEdgarHtmlWithTrace(html, name);
  const segmentation = new DocumentTreeSegmenter().segmentDocument(
    parsed.doc,
    parsed.sourceByNodeId
  );
  return {
    html,
    parsed,
    segmentation,
    doc: parsed.doc,
    trace: buildSectionTrace(parsed.doc, segmentation),
  };
}

describe("buildSectionTrace", () => {
  it("reports every canonical target, resolved or not", () => {
    const { trace: t } = trace("s1_1849470_000110465921035696.htm");
    expect(t.sections.map((s) => s.name).sort()).toEqual(Object.values(S1_SECTIONS).sort());
    expect(t.sections.filter((s) => s.resolved).length).toBeGreaterThan(5);
    expect(t.sections.filter((s) => !s.resolved).every((s) => s.chars === 0)).toBe(true);
  });

  it("finds no unexpected containment on a well-structured prospectus", () => {
    const { trace: t } = trace("s1_1849470_000110465921035696.htm");
    const unexpected = t.sections
      .filter((s) => s.resolved)
      .flatMap((s) =>
        s.contains.filter((i) => !isExpectedContainment(s.name, i)).map((i) => `${s.name}>${i}`)
      );
    expect(unexpected).toEqual([]);
  });

  it("gives a resolved section a span inside the filing HTML", () => {
    const { html, trace: t } = trace("s1_1849470_000110465921035696.htm");
    const resolved = t.sections.filter((s) => s.resolved && s.source !== undefined);
    expect(resolved.length).toBeGreaterThan(5);
    const bad = resolved.filter(
      (s) => s.source!.start < 0 || s.source!.end > html.length || s.source!.end <= s.source!.start
    );
    expect(bad.map((s) => s.name)).toEqual([]);
  });

  /**
   * The span BOUNDS the subtree; it does not slice it. Every indexed leaf under
   * a section sits inside the span the helper returns — that is the whole
   * invariant, and it is asserted against node identity rather than text
   * because a prospectus summary restates management bios verbatim, so the same
   * paragraph text legitimately occurs in two sections at two different spans.
   */
  it("bounds every indexed leaf beneath a section node", () => {
    const { parsed } = trace("s1_1849470_000110465921035696.htm");
    let checked = 0;
    for (const node of traverseDepthFirst(parsed.doc)) {
      if (node.kind !== NodeKind.SECTION) continue;
      const span = subtreeSourceSpan(node, parsed.sourceByNodeId);
      if (span === undefined) continue;
      checked++;
      for (const leaf of traverseDepthFirst(node)) {
        const leafSpan = parsed.sourceByNodeId.get(leaf.nodeId);
        if (leafSpan === undefined) continue;
        expect(leafSpan.start).toBeGreaterThanOrEqual(span.start);
        expect(leafSpan.end).toBeLessThanOrEqual(span.end);
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  /**
   * The converse does NOT hold, and a consumer must not assume it: a body
   * truncated at a swallowed sibling, or a slice taken out of a container,
   * leaves blocks inside the span that the section does not carry. Measured
   * over the committed corpus, that is 29 of 370 resolved sections; another 28
   * differ by the titles of nested sub-headings, which the tree builder mints
   * with no link back to a block.
   */
  it("does not promise the span reconstitutes the section text", () => {
    const { html, segmentation } = trace("s1_1848507_000119312521066104.htm");
    const management = segmentation.sections.find((s) => s.name === S1_SECTIONS.MANAGEMENT);
    expect(management?.source).toBeDefined();
    const slice = html.slice(management!.source!.start, management!.source!.end);
    expect(slice.length).toBeGreaterThan(0);
    expect(slice).not.toEqual(management!.text);
  });

  /** A section a text-level fallback recovered has no mapping, and says so. */
  it("reports an unknown span as undefined, never as zero", () => {
    const { trace: t } = trace("s1_1849470_000110465921035696.htm");
    for (const section of t.sections) {
      if (section.source === undefined) continue;
      expect(section.source.end).toBeGreaterThan(0);
    }
    expect(t.sections.filter((s) => !s.resolved).every((s) => s.source === undefined)).toBe(true);
  });
});

describe("buildChunkTrace", () => {
  it("splits a real risk section into reassembling chunks", () => {
    const { doc } = trace("s1_1849470_000110465921035696.htm");
    const risk = new DocumentTreeSegmenter()
      .segment(doc)
      .find((s) => s.name === S1_SECTIONS.RISK_FACTORS);
    expect(risk).toBeDefined();
    const chunks = buildChunkTrace(risk!.text);
    expect(chunks.chunks.length).toBeGreaterThan(1);
    expect(chunks.reassembles).toBe(true);
    expect(chunks.oversized).toBe(false);
    expect(chunks.chunks.every((c) => c.carriedHeadingVerbatim)).toBe(true);
  });

  it("carries a heading into every chunk after the first", () => {
    const heading = "Risks Related to Our Business";
    const body = Array.from({ length: 12 }, (_, i) => `Caption ${i}. ${"x".repeat(200)}`);
    const trace = buildChunkTrace([heading, ...body].join("\n\n"), 600);
    expect(trace.chunks.length).toBeGreaterThan(2);
    expect(trace.chunks[0]?.carriedHeading).toBeNull();
    expect(trace.chunks.slice(1).every((c) => c.carriedHeading === heading)).toBe(true);
    expect(trace.reassembles).toBe(true);
  });

  it("flags a chunk boundary that cut a rendered table", () => {
    const rows = Array.from({ length: 8 }, (_, i) => `| Row ${i} | ${"v".repeat(120)} |`);
    const trace = buildChunkTrace(rows.join("\n\n"), 300);
    expect(trace.chunks.length).toBeGreaterThan(1);
    expect(trace.splitTables).toBeGreaterThan(0);
  });
});
