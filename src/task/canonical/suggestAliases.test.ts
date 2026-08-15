/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { editDistance, suggestAliases, type FilerName } from "./suggestAliases";

const filer = (cik: number, name: string, current = false): FilerName => ({ cik, name, current });

describe("suggestAliases", () => {
  it("pairs EDGAR's own typo with the correction it later made", () => {
    // All five of these are real: EDGAR filed the registration under the
    // misspelling and corrected the entity name afterwards, leaving the
    // accession carrying the typo forever.
    const names = [
      filer(2042460, "Harvard Ave Acquisition Corp", true),
      filer(2042460, "Harvard Ave Acquistion Corp"),
      filer(2064683, "Cohen Circle Acquisition Corp. II", true),
      filer(2064683, "Cohen Circle Aqusition Corp. II"),
    ];
    const out = suggestAliases("company", names);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      cik: 2042460,
      from: "Harvard Ave Acquistion Corp",
      into: "Harvard Ave Acquisition Corp",
    });
    expect(out[1]!.from).toBe("Cohen Circle Aqusition Corp. II");
  });

  it("does not pair two vehicles of one sponsor", () => {
    // A series marker is what separates two real companies; an alias would
    // merge them.
    const out = suggestAliases("company", [
      filer(1, "Austerlitz Acquisition Corp II", true),
      filer(1, "Austerlitz Acquisition Corp I"),
    ]);
    expect(out).toHaveLength(0);
  });

  it("says nothing when both spellings already key the same", () => {
    // EDGAR's `/Cayman` marker is stripped by the normalizer, so there is no
    // split to alias away.
    const out = suggestAliases("company", [
      filer(2, "Blue Acquisition Corp", true),
      filer(2, "Blue Acquisition Corp/Cayman"),
    ]);
    expect(out).toHaveLength(0);
  });

  it("scores the family tier on family keys", () => {
    const out = suggestAliases("sponsor-family", [
      filer(3, "Churchill Sponsor XIII LLC", true),
      filer(3, "Churchil Sponsor XIII LLC"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.into).toBe("Churchill Sponsor XIII LLC");
  });

  it("ignores short names, where one edit is a different word", () => {
    expect(suggestAliases("company", [filer(4, "Acme Co", true), filer(4, "Acne Co")])).toEqual([]);
  });
});

describe("editDistance", () => {
  it("measures the EDGAR misspellings at or under two edits", () => {
    expect(editDistance("acquistion", "acquisition", 2)).toBe(1);
    expect(editDistance("acquisiton", "acquisition", 2)).toBe(1);
    expect(editDistance("aqusition", "acquisition", 2)).toBe(2);
  });

  it("bails out above the cap instead of measuring", () => {
    expect(editDistance("aaaa", "bbbbbbbbbb", 2)).toBeGreaterThan(2);
  });
});
