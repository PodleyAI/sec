/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { parseEightKSubmission } from "./parseSubmission";

const wrap = (docs: string): string =>
  `<SEC-HEADER>\nACCESSION NUMBER: 0000000000-26-000001\n</SEC-HEADER>\n${docs}`;
const doc = (type: string, seq: number, body: string): string =>
  `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>${seq}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n`;

describe("parseEightKSubmission", () => {
  it("selects the primary 8-K body and collects EX-99.x exhibits", () => {
    const txt = wrap(
      doc("8-K", 1, "<p>Primary body</p>") +
        doc("EX-99.1", 2, "<p>Press release</p>") +
        doc("EX-99.2", 3, "<p>Second exhibit</p>") +
        doc("EX-101.INS", 4, "<xbrl>ignored</xbrl>")
    );
    const out = parseEightKSubmission("8-K", txt);
    expect(out.primaryHtml).toContain("Primary body");
    expect(out.exhibitsHtml).toHaveLength(2);
    expect(out.exhibitsHtml[0]).toContain("Press release");
    expect(out.exhibitsHtml[1]).toContain("Second exhibit");
  });

  it("falls back to <SEQUENCE> 1 then first doc when no TYPE matches the form", () => {
    const txt = wrap(doc("8-K12B", 1, "<p>Seq one</p>") + doc("EX-99.1", 2, "<p>PR</p>"));
    const out = parseEightKSubmission("8-K", txt);
    expect(out.primaryHtml).toContain("Seq one");
    expect(out.exhibitsHtml).toHaveLength(1);
  });

  it("returns a bare body and no exhibits when there is no DOCUMENT envelope", () => {
    const out = parseEightKSubmission("8-K", "<p>just a body</p>");
    expect(out.primaryHtml).toContain("just a body");
    expect(out.exhibitsHtml).toEqual([]);
  });
});
