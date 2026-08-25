/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { S1_SECTIONS } from "../sec/forms/registration-statements/s1/DocumentSegmenter";
import { DocumentTreeSegmenter } from "../sec/forms/registration-statements/s1/DocumentTreeSegmenter";
import { parseEdgarHtml } from "../sec/html/parseEdgarHtml";
import { buildChunkTrace } from "./chunkTrace";
import { buildSectionTrace, isExpectedContainment } from "./sectionTrace";

const fixtureRoot = join(import.meta.dirname, "../sec/html/mock_data/s1");

function trace(name: string) {
  const doc = parseEdgarHtml(readFileSync(join(fixtureRoot, name), "utf8"), name);
  return { doc, trace: buildSectionTrace(doc, new DocumentTreeSegmenter().segmentDocument(doc)) };
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

  /**
   * The offsets are recorded, not trusted. `buildDocumentTree` derives them
   * from a running count over concatenated node text, so a section's reported
   * width and its own text length differ by the separators `renderChildren`
   * inserts — which is exactly why nothing downstream may treat them as
   * locating the section in anything.
   */
  it("records reported offsets without them matching the section text", () => {
    const { trace: t } = trace("s1_1849470_000110465921035696.htm");
    const risk = t.sections.find((s) => s.name === S1_SECTIONS.RISK_FACTORS);
    expect(risk?.resolved).toBe(true);
    expect(risk?.reportedOffsets).toBeDefined();
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
