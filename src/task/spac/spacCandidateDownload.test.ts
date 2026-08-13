/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { SPAC_REGISTRATION_FORMS } from "./classifySpacCandidate";
import {
  DEFAULT_SPAC_DOWNLOAD_CONFIDENCE,
  accessionDocCacheRelative,
  formsForDownloadSet,
  parseSpacDownloadConfidence,
  spacDocFetchFileName,
  spacDocFetchKind,
} from "./spacCandidateDownload";

describe("formsForDownloadSet", () => {
  it("registration is exactly SPAC_REGISTRATION_FORMS", () => {
    expect([...formsForDownloadSet("registration")!].sort()).toEqual(
      [...SPAC_REGISTRATION_FORMS].sort()
    );
  });

  it("8k is 8-K and 8-K/A", () => {
    expect(formsForDownloadSet("8k")).toEqual(new Set(["8-K", "8-K/A"]));
  });

  it("all has no form filter", () => {
    expect(formsForDownloadSet("all")).toBeUndefined();
  });
});

describe("spacDocFetchKind / spacDocFetchFileName", () => {
  it("S-1 and 424B4 fetch the full submission txt", () => {
    expect(spacDocFetchKind("S-1")).toBe("full-submission");
    expect(spacDocFetchFileName("S-1", "0001-21-000001", "s1.htm")).toBe("0001-21-000001.txt");
    expect(spacDocFetchKind("424B4")).toBe("full-submission");
  });

  it("8-K always fetches the full submission txt (no item-code gate)", () => {
    expect(spacDocFetchKind("8-K")).toBe("full-submission");
    expect(spacDocFetchKind("8-K/A")).toBe("full-submission");
    expect(spacDocFetchFileName("8-K", "0001-21-000002", "ex.htm")).toBe("0001-21-000002.txt");
  });

  it("other forms fetch the stripped primary doc", () => {
    expect(spacDocFetchKind("10-K")).toBe("primary-doc");
    expect(spacDocFetchFileName("10-K", "0001-21-000003", "xslF345X03/wf.xml")).toBe("wf.xml");
  });

  it("a null primary_doc yields the empty-name sentinel, not a throw", () => {
    expect(spacDocFetchFileName("10-K", "acc", null)).toBe("");
    expect(spacDocFetchFileName("10-K", "acc", undefined)).toBe("");
    expect(spacDocFetchFileName("10-K", "acc", "   ")).toBe("");
  });

  it("a full-submission form ignores a null primary_doc entirely", () => {
    expect(spacDocFetchFileName("8-K", "acc", null)).toBe("acc.txt");
    expect(spacDocFetchFileName("S-1", "acc", null)).toBe("acc.txt");
  });
});

describe("accessionDocCacheRelative", () => {
  it("matches SecFetchAccessionDocTask.inputToFileName", () => {
    expect(
      accessionDocCacheRelative(1193125, "0001193125-21-066104", "0001193125-21-066104.txt")
    ).toBe("accessiondocs/0001193125/000119312521066104-0001193125-21-066104.txt");
  });
});

describe("parseSpacDownloadConfidence", () => {
  it("defaults to high,medium", () => {
    expect(parseSpacDownloadConfidence(undefined)).toEqual(["high", "medium"]);
    expect(DEFAULT_SPAC_DOWNLOAD_CONFIDENCE).toEqual(["high", "medium"]);
  });

  it("accepts a csv subset", () => {
    expect(parseSpacDownloadConfidence("high")).toEqual(["high"]);
    expect(parseSpacDownloadConfidence("high,low")).toEqual(["high", "low"]);
  });

  it("rejects unknown tokens", () => {
    expect(() => parseSpacDownloadConfidence("high,nope")).toThrow(/high, medium, low/);
  });
});
