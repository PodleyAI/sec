/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { fixtureCik, loadRealS1Sections } from "./realSections";

/**
 * Whichever test segments the corpus first pays for parsing every committed
 * fixture — tens of MB of HTML, and growing with each one added. Later calls in
 * the same process hit the parse cache, so only the first needs the headroom.
 */
const CORPUS_PARSE_TIMEOUT_MS = 120_000;

describe("loadRealS1Sections", () => {
  it(
    "extracts non-empty management sections from committed real S-1 HTML",
    () => {
      const { sections } = loadRealS1Sections(["management"]);
      // The committed corpus has several S-1s with a management section.
      expect(sections.length).toBeGreaterThanOrEqual(3);
      for (const s of sections) {
        expect(s.extractor).toBe("management");
        expect(s.text.trim().length).toBeGreaterThan(0);
        expect(s.filing).toMatch(/^s1_/);
      }
    },
    CORPUS_PARSE_TIMEOUT_MS
  );

  it("returns nothing for an extractor with no mapped section", () => {
    const { sections } = loadRealS1Sections(["not-a-real-extractor"]);
    expect(sections).toHaveLength(0);
  });

  describe("--cik filtering", () => {
    it("limits the sweep to one filer's fixtures", () => {
      const { sections } = loadRealS1Sections(["management"], undefined, ["2147219"]);
      expect(sections.length).toBeGreaterThan(0);
      for (const s of sections) expect(fixtureCik(s.filing)).toBe("2147219");
    });

    it("accepts a zero-padded CIK, since EDGAR writes it both ways", () => {
      const padded = loadRealS1Sections(["management"], undefined, ["0002147219"]);
      const bare = loadRealS1Sections(["management"], undefined, ["2147219"]);
      expect(padded.sections.map((s) => s.filing)).toEqual(bare.sections.map((s) => s.filing));
      expect(padded.sections.length).toBeGreaterThan(0);
    });

    it("selects several filers at once", () => {
      const { sections } = loadRealS1Sections(["management"], undefined, ["2147219", "95572"]);
      const ciks = new Set(sections.map((s) => fixtureCik(s.filing)));
      expect(ciks).toEqual(new Set(["2147219", "95572"]));
    });

    // An empty sweep would render as a passing run of zero sections, which is
    // the one outcome a "check just this filing" flag must never produce.
    it("throws — listing the available CIKs — when nothing matches", () => {
      expect(() => loadRealS1Sections(["management"], undefined, ["9999999"])).toThrow(
        /No S-1 fixture matches CIK 9999999.*Available CIKs:.*2147219/s
      );
    });
  });

  describe("fixtureCik", () => {
    it("reads the CIK out of a fixture basename, unpadded", () => {
      expect(fixtureCik("s1_95572_000121390026086369")).toBe("95572");
      expect(fixtureCik("s1_0002147219_000110465926092088")).toBe("2147219");
      expect(fixtureCik("424b4_2114227_000121390026048413")).toBe("2114227");
    });

    it("returns null for a name that is not of the fixture shape", () => {
      expect(fixtureCik("SOURCES")).toBeNull();
      expect(fixtureCik("s1_notacik_000121390026086369")).toBeNull();
    });
  });
});
