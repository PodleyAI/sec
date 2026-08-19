/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { shouldReplaySpacFiling } from "./shouldReplaySpacFiling";

const CIK = 1800001;
const S1 = "0000000000-26-000001";
const B424 = "0000000000-26-000002";
const EIGHT_K_TRIGGER = "0000000000-26-000003";
const EIGHT_K_OTHER = "0000000000-26-000004";

function keysFor(extractorId: string, accessions: readonly string[]): Map<string, Set<string>> {
  return new Map([
    [
      extractorId,
      new Set(accessions.map((accession_number) => filingRunKey({ cik: CIK, accession_number }))),
    ],
  ]);
}

describe("shouldReplaySpacFiling", () => {
  it("skips a successful S-1 when force is none", () => {
    expect(
      shouldReplaySpacFiling({
        form: "S-1",
        items: null,
        cik: CIK,
        accession_number: S1,
        force: { kind: "none" },
        successfulKeys: keysFor("S-1", [S1]),
      })
    ).toBe(false);
  });

  it("replays an unprocessed 8-K when force is none", () => {
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "2.02",
        cik: CIK,
        accession_number: EIGHT_K_OTHER,
        force: { kind: "none" },
        successfulKeys: keysFor("S-1", [S1]),
      })
    ).toBe(true);
  });

  it("replays a successful S-1 when force is all", () => {
    expect(
      shouldReplaySpacFiling({
        form: "S-1",
        items: null,
        cik: CIK,
        accession_number: S1,
        force: { kind: "all" },
        successfulKeys: keysFor("S-1", [S1]),
      })
    ).toBe(true);
  });

  it("replays a successful S-1 and skips a successful 424 when only S-1 is forced", () => {
    const successfulKeys = new Map([...keysFor("S-1", [S1]), ...keysFor("424", [B424])]);
    expect(
      shouldReplaySpacFiling({
        form: "S-1",
        items: null,
        cik: CIK,
        accession_number: S1,
        force: { kind: "extractors", ids: ["S-1"] },
        successfulKeys,
      })
    ).toBe(true);
    expect(
      shouldReplaySpacFiling({
        form: "424B4",
        items: null,
        cik: CIK,
        accession_number: B424,
        force: { kind: "extractors", ids: ["S-1"] },
        successfulKeys,
      })
    ).toBe(false);
  });

  it("replays a redemption-trigger 8-K and skips a successful non-trigger 8-K", () => {
    const successfulKeys = keysFor("8-K", [EIGHT_K_TRIGGER, EIGHT_K_OTHER]);
    const force = { kind: "extractors" as const, ids: ["redemption" as const] };
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "5.07,9.01",
        cik: CIK,
        accession_number: EIGHT_K_TRIGGER,
        force,
        successfulKeys,
      })
    ).toBe(true);
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "2.02",
        cik: CIK,
        accession_number: EIGHT_K_OTHER,
        force,
        successfulKeys,
      })
    ).toBe(false);
  });

  it("replays every 8-K when 8-K is forced", () => {
    const successfulKeys = keysFor("8-K", [EIGHT_K_TRIGGER, EIGHT_K_OTHER]);
    const force = { kind: "extractors" as const, ids: ["8-K" as const] };
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "2.02",
        cik: CIK,
        accession_number: EIGHT_K_OTHER,
        force,
        successfulKeys,
      })
    ).toBe(true);
    expect(
      shouldReplaySpacFiling({
        form: "8-K/A",
        items: "5.07",
        cik: CIK,
        accession_number: EIGHT_K_TRIGGER,
        force,
        successfulKeys,
      })
    ).toBe(true);
  });
});
