/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { extractPrimaryDocFromSubmission, streamFeedTarball, type FeedEntry } from "./feedTarball";

/** Builds a single ustar tar header block for a regular file. */
function tarHeader(name: string, size: number): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0, "ascii");
  h.write("0000644\0", 100, "ascii");
  h.write("0000000\0", 108, "ascii");
  h.write("0000000\0", 116, "ascii");
  h.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  h.write("00000000000\0", 136, "ascii");
  h.write("        ", 148, "ascii"); // checksum placeholder (spaces)
  h.write("0", 156, "ascii"); // typeflag: regular file
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += h[i];
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

function makeTarGz(entries: ReadonlyArray<{ name: string; body: string }>): Buffer {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const body = Buffer.from(e.body, "utf-8");
    parts.push(tarHeader(e.name, body.length));
    parts.push(body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad > 0) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024)); // two zero blocks terminate the archive
  return gzipSync(Buffer.concat(parts));
}

async function collect(gz: Buffer, want: (accession: string) => boolean): Promise<FeedEntry[]> {
  const out: FeedEntry[] = [];
  await streamFeedTarball(Readable.from([gz]), want, (e) => {
    out.push(e);
  });
  return out;
}

describe("streamFeedTarball", () => {
  it("yields only wanted members and lifts the accession from the member name", async () => {
    const gz = makeTarGz([
      { name: "20210305.nc/0001193125-21-066104.nc", body: "SUBMISSION-A" },
      { name: "20210305.nc/0000320193-21-000010.nc", body: "SUBMISSION-B" },
      { name: "20210305.nc/0009999999-21-999999.nc", body: "UNWANTED" },
    ]);
    const wanted = new Set(["0001193125-21-066104", "0000320193-21-000010"]);
    const entries = await collect(gz, (a) => wanted.has(a));

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.accession).sort()).toEqual([
      "0000320193-21-000010",
      "0001193125-21-066104",
    ]);
    const a = entries.find((e) => e.accession === "0001193125-21-066104");
    expect(a?.text).toBe("SUBMISSION-A");
  });

  it("handles a flat member layout and a body that is not a multiple of 512", async () => {
    const body = "x".repeat(1000); // spans two 512 blocks with padding
    const gz = makeTarGz([{ name: "0001193125-21-066104.nc", body }]);
    const entries = await collect(gz, () => true);
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe(body);
    expect(entries[0].text.length).toBe(1000);
  });

  it("returns nothing when no member is wanted (skips every body)", async () => {
    const gz = makeTarGz([
      { name: "0001-21-000001.nc", body: "a" },
      { name: "0002-21-000002.nc", body: "b" },
    ]);
    // Accession shape (10-2-6) doesn't match these short names, and want=false anyway.
    const entries = await collect(gz, () => false);
    expect(entries).toHaveLength(0);
  });
});

describe("extractPrimaryDocFromSubmission", () => {
  const submission = [
    "<SEC-DOCUMENT>0001193125-21-066104.txt : 20210305",
    "<SEC-HEADER>0001193125-21-066104.hdr.sgml : 20210305",
    "CENTRAL INDEX KEY:			0001193125",
    "</SEC-HEADER>",
    "<DOCUMENT>",
    "<TYPE>4",
    "<SEQUENCE>1",
    "<FILENAME>wf-form4_123.xml",
    "<TEXT>",
    '<?xml version="1.0"?><ownershipDocument><issuer/></ownershipDocument>',
    "</TEXT>",
    "</DOCUMENT>",
    "<DOCUMENT>",
    "<TYPE>EX-99.1",
    "<SEQUENCE>2",
    "<FILENAME>ex99.htm",
    "<TEXT>",
    "<html>press release</html>",
    "</TEXT>",
    "</DOCUMENT>",
  ].join("\n");

  it("slices the document body for an exact filename match", () => {
    const body = extractPrimaryDocFromSubmission(submission, "wf-form4_123.xml");
    expect(body).toBe('<?xml version="1.0"?><ownershipDocument><issuer/></ownershipDocument>');
  });

  it("matches case-insensitively", () => {
    const body = extractPrimaryDocFromSubmission(submission, "EX99.HTM");
    expect(body).toBe("<html>press release</html>");
  });

  it("returns undefined for a filename not present", () => {
    expect(extractPrimaryDocFromSubmission(submission, "nope.xml")).toBeUndefined();
  });

  it("refuses to reconstruct a binary (PDF) member", () => {
    const pdf = [
      "<DOCUMENT>",
      "<TYPE>EX-99.2",
      "<FILENAME>chart.pdf",
      "<TEXT>",
      "<PDF>",
      "JVBERi0xLjQKm-uncoded-bytes",
      "</PDF>",
      "</TEXT>",
      "</DOCUMENT>",
    ].join("\n");
    expect(extractPrimaryDocFromSubmission(pdf, "chart.pdf")).toBeUndefined();
  });
});
