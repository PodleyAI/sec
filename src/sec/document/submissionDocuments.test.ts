/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { listConvertibleDocuments } from "./submissionDocuments";

const BODY = "<html><body><p>Body text here.</p></body></html>";

const doc = (type: string, seq: number, file: string, body = BODY, description?: string): string =>
  `<DOCUMENT>
<TYPE>${type}
<SEQUENCE>${seq}
<FILENAME>${file}
${description === undefined ? "" : `<DESCRIPTION>${description}\n`}<TEXT>
${body}
</TEXT>
</DOCUMENT>`;

const submission = (...docs: string[]): string =>
  `<SEC-DOCUMENT>0001-26-1.txt : 20260101
<SEC-HEADER>0001-26-1.hdr.sgml : 20260101
COMPANY CONFORMED NAME: EXAMPLE ACQUISITION CORP
</SEC-HEADER>
${docs.join("\n")}
</SEC-DOCUMENT>`;

const files = (text: string, form = "8-K"): string[] =>
  listConvertibleDocuments(form, text, "form8k.htm").map((d) => d.docFile);

/**
 * The member filter is a DENYLIST on the not-prose axis, so what pins it is the
 * pair of lists: what a real submission carries that must survive, and every
 * shape of machine data EDGAR files alongside it that must not.
 */
describe("listConvertibleDocuments type filter", () => {
  const KEPT: readonly (readonly [string, string])[] = [
    ["EX-99.1", "ex99-1.htm"],
    ["EX-10.1", "ex10-1.htm"],
    ["EX-10", "ex10.htm"],
    ["EX-2.1", "ex2-1.htm"],
    ["EX-3.1", "ex3-1.htm"],
    ["EX-4.1", "ex4-1.htm"],
    ["EX-96.1", "ex96-1.htm"],
    // Boilerplate, but prose, and a document the filing genuinely contains. A
    // directory listing that omits it is not a listing of that filing.
    ["EX-23.1", "ex23-1.htm"],
    ["EX-31.1", "ex31-1.htm"],
  ];

  const DROPPED: readonly (readonly [string, string])[] = [
    // XBRL, in every generation EDGAR has shipped.
    ["EX-101.INS", "ex101.xml"],
    ["EX-101.SCH", "ex101sch.xsd"],
    ["EX-100.INS", "ex100.xml"],
    ["EX-104", "ex104.htm"],
    ["EX-FILING FEES", "fee.htm"],
    ["EX-27.1", "ex27.txt"],
    // Binary and media, by type.
    ["GRAPHIC", "logo.jpg"],
    ["ZIP", "bundle.zip"],
    ["EXCEL", "financials.xlsx"],
    ["AUDIO", "call.mp3"],
    ["VIDEO", "presentation.mp4"],
    // Markup submitted as a member in its own right.
    ["XML", "data.xml"],
    ["JSON", "data.json"],
    ["XSD", "schema.xsd"],
    // Honest-looking types whose FILENAME gives them away — the commoner case
    // than a mislabelled type.
    ["EX-99.9", "chart.gif"],
    ["EX-99.8", "deck.pdf"],
    ["EX-99.7", "icon.svg"],
  ];

  const everything = submission(
    doc("8-K", 1, "form8k.htm"),
    ...KEPT.map(([type, file], i) => doc(type, i + 2, file)),
    ...DROPPED.map(([type, file], i) => doc(type, i + 40, file))
  );

  it("keeps the primary document and every prose exhibit", () => {
    const kept = new Set(files(everything));
    expect(kept.has("form8k.htm")).toBe(true);
    for (const [type, file] of KEPT) expect(kept.has(file), `${type} ${file}`).toBe(true);
  });

  it("drops every machine-data and binary member", () => {
    const kept = new Set(files(everything));
    for (const [type, file] of DROPPED) expect(kept.has(file), `${type} ${file}`).toBe(false);
  });

  it("does not mistake a material contract for XBRL", () => {
    // `EX-10.1` and `EX-101.INS` differ by one character in the wrong place.
    expect(files(submission(doc("8-K", 1, "form8k.htm"), doc("EX-10.1", 2, "ex10-1.htm")))).toEqual(
      ["form8k.htm", "ex10-1.htm"]
    );
  });

  it("drops a member whose body is a binary envelope, however it is labelled", () => {
    const mislabelled = submission(
      doc("8-K", 1, "form8k.htm"),
      doc("EX-99.1", 2, "ex99-1.htm", "<PDF>\n%PDF-1.4 binary follows"),
      doc("EX-99.2", 3, "ex99-2.htm", "begin 644 chart.gif\nM0V]N=&5N=',@;V8@=&AE(&9I;&4`")
    );
    expect(files(mislabelled)).toEqual(["form8k.htm"]);
  });

  it("drops the primary too when ITS body is binary, rather than rendering mojibake", () => {
    expect(files(submission(doc("8-K", 1, "form8k.htm", "<PDF>\n%PDF-1.4")))).toEqual([]);
  });

  it("keeps a member with no <TYPE> at all, since a denylist fails open", () => {
    const untyped = `<DOCUMENT>\n<SEQUENCE>2\n<FILENAME>mystery.htm\n<TEXT>\n${BODY}\n</TEXT>\n</DOCUMENT>`;
    expect(files(submission(doc("8-K", 1, "form8k.htm"), untyped))).toContain("mystery.htm");
  });

  it("drops a member with no <FILENAME>, which cannot be addressed in a URL", () => {
    const unnamed = `<DOCUMENT>\n<TYPE>EX-99.1\n<SEQUENCE>2\n<TEXT>\n${BODY}\n</TEXT>\n</DOCUMENT>`;
    expect(files(submission(doc("8-K", 1, "form8k.htm"), unnamed))).toEqual(["form8k.htm"]);
  });

  it("keeps the first of two members claiming one filename", () => {
    // The row key is the filename, so a duplicate would overwrite the document
    // a reader is looking at rather than appearing beside it.
    const clash = submission(
      doc("8-K", 1, "form8k.htm"),
      doc("EX-99.1", 2, "ex99-1.htm", "<html><body><p>First.</p></body></html>"),
      doc("EX-99.2", 3, "ex99-1.htm", "<html><body><p>Second.</p></body></html>")
    );
    const out = listConvertibleDocuments("8-K", clash, "form8k.htm");
    expect(out.map((d) => d.docFile)).toEqual(["form8k.htm", "ex99-1.htm"]);
    expect(out[1].docType).toBe("EX-99.1");
  });

  it("keeps the PRIMARY when an earlier member claims the same filename", () => {
    // The primary names no file of its own, so it falls back to the name the
    // caller loaded — which an exhibit filed ahead of it also declares. Dropping
    // "the first in document order" would drop the primary, and a submission
    // stored with no primary row is one the sweep's anti-join re-selects on
    // every run forever.
    const clash = submission(
      doc("EX-99.1", 2, "form8k.htm", "<html><body><p>Exhibit.</p></body></html>"),
      `<DOCUMENT>\n<TYPE>8-K\n<SEQUENCE>1\n<TEXT>\n${BODY}\n</TEXT>\n</DOCUMENT>`
    );
    const out = listConvertibleDocuments("8-K", clash, "form8k.htm");
    expect(out.map((d) => d.docFile)).toEqual(["form8k.htm"]);
    expect(out[0].isPrimary).toBe(true);
    expect(out[0].docType).toBe("8-K");
  });
});
