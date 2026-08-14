/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import {
  formatExhibitDetail,
  parseEightKSubmission,
  parseSubmissionExhibits,
} from "./parseSubmission";

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

const docMeta = (
  type: string,
  seq: number,
  body: string,
  description: string,
  filename: string
): string =>
  `<DOCUMENT>\n<TYPE>${type}\n<SEQUENCE>${seq}\n<FILENAME>${filename}\n<DESCRIPTION>${description}\n<TEXT>\n${body}\n</TEXT>\n</DOCUMENT>\n`;

describe("parseSubmissionExhibits", () => {
  it("returns EX-* rows with type, description, and filename, skipping 8-K body, GRAPHIC, and XBRL", () => {
    const txt = wrap(
      docMeta("8-K", 1, "<p>body</p>", "CURRENT REPORT", "d8k.htm") +
        docMeta(
          "EX-1.1",
          2,
          "<p>uw</p>",
          "UNDERWRITING AGREEMENT, DATED JANUARY 14, 2021, BY AND BETWEEN THE COMPANY AND C",
          "ex11.htm"
        ) +
        docMeta("GRAPHIC", 3, "binary", "IMAGE", "img.jpg") +
        docMeta("EX-101.INS", 4, "<xbrl/>", "XBRL INSTANCE", "ins.xml") +
        docMeta(
          "EX-2.1",
          5,
          "<p>bca</p>",
          "AGREEMENT AND PLAN OF MERGER, DATED AUGUST 31, 2021",
          "ex21.htm"
        )
    );
    expect(parseSubmissionExhibits(txt)).toEqual([
      {
        type: "EX-1.1",
        description:
          "UNDERWRITING AGREEMENT, DATED JANUARY 14, 2021, BY AND BETWEEN THE COMPANY AND C",
        filename: "ex11.htm",
      },
      {
        type: "EX-2.1",
        description: "AGREEMENT AND PLAN OF MERGER, DATED AUGUST 31, 2021",
        filename: "ex21.htm",
      },
    ]);
  });

  it("returns [] when there is no DOCUMENT envelope", () => {
    expect(parseSubmissionExhibits("<p>bare</p>")).toEqual([]);
  });
});

describe("formatExhibitDetail", () => {
  it("formats type, description cut at first comma, and filename", () => {
    expect(
      formatExhibitDetail([
        {
          type: "EX-1.1",
          description: "UNDERWRITING AGREEMENT, DATED JANUARY 14, 2021, BY AND BETWEEN THE COMPANY AND C",
          filename: "ex11.htm",
        },
      ])
    ).toBe("EX-1.1 UNDERWRITING AGREEMENT\tex11.htm");
  });

  it("omits a description that just restates TYPE", () => {
    expect(
      formatExhibitDetail([
        { type: "EX-2.1", description: "EX-2.1", filename: "d137294dex21.htm" },
      ])
    ).toBe("EX-2.1\td137294dex21.htm");
  });

  it("clips a long list at the last newline so it stays <= 1024", () => {
    const exhibits = Array.from({ length: 40 }, (_, i) => ({
      type: `EX-10.${i + 1}`,
      description: `LONG EXHIBIT DESCRIPTION NUMBER ${i + 1} THAT TAKES SPACE`,
      filename: `ex10${String(i + 1).padStart(2, "0")}.htm`,
    }));
    const detail = formatExhibitDetail(exhibits);
    expect(detail).not.toBeNull();
    expect(detail!.length).toBeLessThanOrEqual(1024);
    expect(detail!.endsWith("\n")).toBe(false);
    expect(detail!.includes("\n")).toBe(true);
  });
});
