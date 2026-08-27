/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { NodeKind, uuid4 } from "workglow";
import { demoteCoverPageHeadings } from "./coverPage";
import type { EdgarBlock, ResolvedStyle } from "./types";

const STYLE: ResolvedStyle = {
  fontSizePt: 14,
  bold: true,
  italic: false,
  underline: false,
  centered: true,
  upperRatio: 1,
};

let nextSpanStart = 0;
const span = (): { readonly start: number; readonly end: number } => {
  const start = nextSpanStart;
  nextSpanStart += 10;
  return { start, end: start + 5 };
};
const heading = (text: string): EdgarBlock => ({
  type: "heading",
  text,
  style: STYLE,
  level: 1,
  source: span(),
});
const para = (text: string): EdgarBlock => ({
  type: "paragraph",
  node: {
    nodeId: uuid4(),
    kind: NodeKind.PARAGRAPH,
    range: { startOffset: 0, endOffset: 0 },
    text,
  },
  source: span(),
});

const texts = (blocks: readonly EdgarBlock[]): string[] =>
  blocks.map((b) =>
    b.type === "heading" ? `H:${b.text}` : b.type === "paragraph" ? `P:${b.node.text}` : b.type
  );

describe("demoteCoverPageHeadings", () => {
  it("turns cover-page headings into prose and leaves the rest alone", () => {
    const out = demoteCoverPageHeadings([
      heading("UNITED STATES"),
      heading("FORM S-1"),
      para("Flux Power Holdings, Inc."),
      heading("TABLE OF CONTENTS"),
      heading("PROSPECTUS SUMMARY"),
      para("We are a blank check company."),
    ]);
    expect(texts(out)).toEqual([
      "P:UNITED STATES",
      "P:FORM S-1",
      "P:Flux Power Holdings, Inc.",
      "H:TABLE OF CONTENTS",
      "H:PROSPECTUS SUMMARY",
      "P:We are a blank check company.",
    ]);
  });

  it("keeps every demoted heading's text and source span", () => {
    const cover = heading("SECURITIES AND EXCHANGE COMMISSION");
    const [out] = demoteCoverPageHeadings([cover, heading("Table of Contents")]);
    expect(out?.type).toBe("paragraph");
    expect(out?.source).toEqual(cover.source);
    expect(out?.type === "paragraph" && out.node.text).toBe("SECURITIES AND EXCHANGE COMMISSION");
  });

  it("never demotes a heading the segmenter targets", () => {
    // A form whose front matter is prose could open on a real section; that
    // heading has to survive whatever the cover-page rule says.
    const out = demoteCoverPageHeadings([
      heading("NOTICE OF SPECIAL MEETING"),
      heading("RISK FACTORS"),
      heading("TABLE OF CONTENTS"),
    ]);
    expect(texts(out)).toEqual([
      "P:NOTICE OF SPECIAL MEETING",
      "H:RISK FACTORS",
      "H:TABLE OF CONTENTS",
    ]);
  });

  it("leaves a filing with no table of contents untouched", () => {
    const blocks = [heading("ITEM 5.02"), para("On May 22, 2026, the registrant appointed…")];
    expect(demoteCoverPageHeadings(blocks)).toEqual(blocks);
  });

  it("leaves a filing that opens on its table of contents untouched", () => {
    const blocks = [heading("TABLE OF CONTENTS"), heading("BUSINESS")];
    expect(demoteCoverPageHeadings(blocks)).toEqual(blocks);
  });

  it("does not scan past the front matter for a late table of contents", () => {
    const deep = [...Array(220)].map((_, i) => heading(`COVER LINE ${i}`));
    const out = demoteCoverPageHeadings([...deep, heading("Table of Contents")]);
    expect(out.every((b) => b.type === "heading")).toBe(true);
  });
});
