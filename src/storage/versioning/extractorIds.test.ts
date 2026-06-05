/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import { EXTRACTOR_IDS, FORM_TO_EXTRACTOR_ID, formToExtractorId } from "./extractorIds";

describe("extractorIds", () => {
  it("exposes the canonical extractor ids", () => {
    expect([...EXTRACTOR_IDS].sort()).toEqual([
      "1-A",
      "1-K",
      "1-Z",
      "144",
      "3",
      "4",
      "5",
      "C",
      "D",
      "S-1",
    ]);
  });

  it("maps Form 3/4/5 and amendments to their document-type extractor ids", () => {
    for (const form of ["3", "4", "5"]) {
      expect(formToExtractorId(form)).toBe(form);
      expect(formToExtractorId(`${form}/A`)).toBe(form);
    }
  });

  it("maps Form 144 and its amendment to extractor id '144'", () => {
    expect(formToExtractorId("144")).toBe("144");
    expect(formToExtractorId("144/A")).toBe("144");
  });

  it("maps Form D and amendments to extractor id 'D'", () => {
    expect(formToExtractorId("D")).toBe("D");
    expect(formToExtractorId("D/A")).toBe("D");
  });

  it("maps every Form C variant to extractor id 'C'", () => {
    for (const v of [
      "C",
      "C/A",
      "C-W",
      "C-U",
      "C-U-W",
      "C/A-W",
      "C-AR",
      "C-AR-W",
      "C-AR/A",
      "C-AR/A-W",
      "C-TR",
      "C-TR-W",
    ]) {
      expect(formToExtractorId(v)).toBe("C");
    }
  });

  it("maps Form 1-A and amendments to extractor id '1-A'", () => {
    expect(formToExtractorId("1-A")).toBe("1-A");
    expect(formToExtractorId("1-A/A")).toBe("1-A");
  });

  it("maps Form 1-K and amendments to extractor id '1-K'", () => {
    expect(formToExtractorId("1-K")).toBe("1-K");
    expect(formToExtractorId("1-K/A")).toBe("1-K");
  });

  it("maps Form 1-Z and amendments to extractor id '1-Z'", () => {
    expect(formToExtractorId("1-Z")).toBe("1-Z");
    expect(formToExtractorId("1-Z/A")).toBe("1-Z");
  });

  it("returns undefined for unknown forms", () => {
    expect(formToExtractorId("10-K")).toBeUndefined();
    expect(formToExtractorId("")).toBeUndefined();
  });

  it("FORM_TO_EXTRACTOR_ID covers every variant exactly once", () => {
    const seen = new Set(Object.keys(FORM_TO_EXTRACTOR_ID));
    expect(seen.has("D/A")).toBe(true);
    expect(seen.has("C-AR/A-W")).toBe(true);
    expect(seen.has("1-Z/A")).toBe(true);
  });
});

describe("extractorIds — S-1", () => {
  it("includes S-1 in the registry", () => {
    expect(EXTRACTOR_IDS).toContain("S-1");
  });

  it("maps S-1 form symbols to the S-1 extractor", () => {
    expect(formToExtractorId("S-1")).toBe("S-1");
    expect(formToExtractorId("S-1/A")).toBe("S-1");
    expect(formToExtractorId("S-1MEF")).toBe("S-1");
  });
});

describe("extractorIds + ALL_FORMS_MAP invariant", () => {
  it("every form in FORM_TO_EXTRACTOR_ID is registered in ALL_FORMS_MAP", () => {
    const missing: string[] = [];
    for (const form of Object.keys(FORM_TO_EXTRACTOR_ID)) {
      if (!ALL_FORMS_MAP.has(form)) {
        missing.push(form);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("extractorIds — DRS dispatch mapping", () => {
  it("maps DRS and DRS/A to the S-1 extractor and leaves DRSLTR unmapped", () => {
    expect(formToExtractorId("DRS")).toBe("S-1");
    expect(formToExtractorId("DRS/A")).toBe("S-1");
    expect(formToExtractorId("DRSLTR")).toBeUndefined();
  });
});

describe("extractorIds — F-1 (foreign issuer) dispatch mapping", () => {
  it("maps F-1, F-1/A, and F-1MEF to the S-1 extractor", () => {
    expect(formToExtractorId("F-1")).toBe("S-1");
    expect(formToExtractorId("F-1/A")).toBe("S-1");
    expect(formToExtractorId("F-1MEF")).toBe("S-1");
  });
});
