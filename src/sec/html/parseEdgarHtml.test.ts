/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import type { SectionNode } from "workglow";
import { NodeKind, renderMarkdown, traverseDepthFirst } from "workglow";
import { parseEdgarHtml } from "./parseEdgarHtml";

describe("parseEdgarHtml", () => {
  it("produces a section tree with a structured table, de-paginated", () => {
    const html = `
      <html><body>
        <p style="font-weight:700;text-align:center;font-size:16pt">MANAGEMENT</p>
        <p>Our directors and officers are listed below.</p>
        <p style="font-weight:700;font-size:13pt">Executive Officers</p>
        <table>
          <tr><th>Name</th><th>Shares</th></tr>
          <tr><td>Alice</td><td>1,250</td></tr>
        </table>
        <div style="page-break-after:always"></div>
        <p>ACME CORPORATION</p>
        <table>
          <tr><th>Name</th><th>Shares</th></tr>
          <tr><td>Bob</td><td>2,000</td></tr>
        </table>
      </body></html>`;
    const doc = parseEdgarHtml(html, "ACME S-1");
    expect(doc.kind).toBe(NodeKind.DOCUMENT);

    const sections = [...traverseDepthFirst(doc)].filter(
      (n) => n.kind === NodeKind.SECTION
    ) as SectionNode[];
    const titles = sections.map((s) => s.title);
    expect(titles).toContain("MANAGEMENT");
    expect(titles).toContain("Executive Officers");

    const mgmt = sections.find((s) => s.title === "MANAGEMENT")!;
    expect(mgmt.level).toBe(1);
    const exec = sections.find((s) => s.title === "Executive Officers")!;
    expect(exec.level).toBe(2);

    // The two page-split table fragments stitched into one table with 2 body rows.
    const tables = [...traverseDepthFirst(doc)].filter((n) => n.kind === NodeKind.TABLE);
    expect(tables).toHaveLength(1);

    const md = renderMarkdown(doc);
    expect(md).toContain("# MANAGEMENT");
    expect(md).toContain("## Executive Officers");
    expect(md).toContain("Alice");
    expect(md).toContain("Bob");
  });
});
