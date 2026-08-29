/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeAll, describe, expect, it } from "vitest";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { registerFormExtractor } from "../../sec/forms/formExtractors";
import { filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { shouldReplaySpacFiling } from "./shouldReplaySpacFiling";

const CIK = 1800001;
const NO_GATED: ReadonlySet<string> = new Set<string>();
const S1 = "0000000000-26-000001";
const B424 = "0000000000-26-000002";
const EIGHT_K_TRIGGER = "0000000000-26-000003";
const EIGHT_K_OTHER = "0000000000-26-000004";
const S4 = "S-4";
const S4_ACCESSION = "0000000000-26-000005";

const noopStore = async (): Promise<void> => {};

beforeAll(() => {
  // The predicate reads the form-extractor registry, so sec's own extractors
  // have to be in it before any case runs.
  registerSecFormExtractors();
  // A de-SPAC `S-4` is a registration statement AND the merger proxy for the
  // same vote, so it carries two extractors — and the ROW-GATED one is not the
  // first. `S-4` is deliberately a form the shipped 1:1 map has no entry for.
  registerFormExtractor({ id: "S-4", forms: [S4], store: noopStore });
  // A second registry key under an EXISTING id, so the shipped `merger-proxy`
  // registration is widened rather than replaced.
  registerFormExtractor({ id: "merger-proxy", section: "de-spac", forms: [S4], store: noopStore });
  // An 8-K carries two extractors too: the item codes this package records
  // under `8-K-items`, and the de-SPAC milestone reading a consumer registers
  // under `8-K` — the one whose known-SPAC gate can swallow a filing, and the
  // one the redemption / LOI forcing clause keys on. Without the second, none
  // of that is reachable here.
  registerFormExtractor({ id: "8-K", forms: ["8-K", "8-K/A"], store: noopStore });
});

function keysFor(extractorId: string, accessions: readonly string[]): Map<string, Set<string>> {
  return new Map([
    [
      extractorId,
      new Set(accessions.map((accession_number) => filingRunKey({ cik: CIK, accession_number }))),
    ],
  ]);
}

/** Both of an 8-K's extractors have a successful run on the given filings. */
function eightKKeys(accessions: readonly string[]): Map<string, Set<string>> {
  return new Map([...keysFor("8-K-items", accessions), ...keysFor("8-K", accessions)]);
}

/** Both of the `S-4` fixture's extractors have a successful run on it. */
function bothSucceeded(): Map<string, Set<string>> {
  return new Map([...keysFor("S-4", [S4_ACCESSION]), ...keysFor("merger-proxy", [S4_ACCESSION])]);
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
        successfulKeys: keysFor("S-1-xbrl", [S1]),
        gatedNoOpAccessions: NO_GATED,
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
        successfulKeys: keysFor("S-1-xbrl", [S1]),
        gatedNoOpAccessions: NO_GATED,
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
        successfulKeys: keysFor("S-1-xbrl", [S1]),
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(true);
  });

  it("replays a successful S-1 and skips a successful 424 when only S-1 is forced", () => {
    const successfulKeys = new Map([...keysFor("S-1-xbrl", [S1]), ...keysFor("424-xbrl", [B424])]);
    expect(
      shouldReplaySpacFiling({
        form: "S-1",
        items: null,
        cik: CIK,
        accession_number: S1,
        force: { kind: "extractors", ids: ["S-1-xbrl"] },
        successfulKeys,
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(true);
    expect(
      shouldReplaySpacFiling({
        form: "424B4",
        items: null,
        cik: CIK,
        accession_number: B424,
        force: { kind: "extractors", ids: ["S-1-xbrl"] },
        successfulKeys,
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(false);
  });

  it("replays a redemption-trigger 8-K and skips a successful non-trigger 8-K", () => {
    const successfulKeys = eightKKeys([EIGHT_K_TRIGGER, EIGHT_K_OTHER]);
    const force = { kind: "extractors" as const, ids: ["redemption" as const] };
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "5.07,9.01",
        cik: CIK,
        accession_number: EIGHT_K_TRIGGER,
        force,
        successfulKeys,
        gatedNoOpAccessions: NO_GATED,
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
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(false);
  });

  it("replays every 8-K when 8-K is forced", () => {
    const successfulKeys = eightKKeys([EIGHT_K_TRIGGER, EIGHT_K_OTHER]);
    const force = { kind: "extractors" as const, ids: ["8-K" as const] };
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "2.02",
        cik: CIK,
        accession_number: EIGHT_K_OTHER,
        force,
        successfulKeys,
        gatedNoOpAccessions: NO_GATED,
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
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(true);
  });

  it("replays a successful gated 8-K that produced no artifact", () => {
    // The whole point of `spac process`: the 8-K handler is gated on a `spac`
    // row and records success while writing nothing when the row is absent, so
    // the already-succeeded skip left the filing unrepairable forever.
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "5.07",
        cik: CIK,
        accession_number: EIGHT_K_TRIGGER,
        force: { kind: "none" },
        successfulKeys: eightKKeys([EIGHT_K_TRIGGER]),
        gatedNoOpAccessions: new Set([EIGHT_K_TRIGGER]),
      })
    ).toBe(true);
  });

  it("still skips a successful gated 8-K that did produce an artifact", () => {
    expect(
      shouldReplaySpacFiling({
        form: "8-K",
        items: "5.07",
        cik: CIK,
        accession_number: EIGHT_K_TRIGGER,
        force: { kind: "none" },
        successfulKeys: eightKKeys([EIGHT_K_TRIGGER]),
        gatedNoOpAccessions: new Set([EIGHT_K_OTHER]),
      })
    ).toBe(false);
  });

  it("skips a two-extractor filing only once every one of them has succeeded", () => {
    // A single-id lookup answers with whichever extractor is named first, so a
    // filing whose SECOND extractor never ran reads as already processed.
    expect(
      shouldReplaySpacFiling({
        form: S4,
        items: null,
        cik: CIK,
        accession_number: S4_ACCESSION,
        force: { kind: "none" },
        successfulKeys: bothSucceeded(),
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(false);
    expect(
      shouldReplaySpacFiling({
        form: S4,
        items: null,
        cik: CIK,
        accession_number: S4_ACCESSION,
        force: { kind: "none" },
        successfulKeys: keysFor("S-4", [S4_ACCESSION]),
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(true);
  });

  it("treats a two-extractor filing as row-gated when the SECOND extractor is the gated one", () => {
    // The gate is a question about the set: one row-gated extractor among
    // several is enough for the filing's work to have been swallowed.
    expect(
      shouldReplaySpacFiling({
        form: S4,
        items: null,
        cik: CIK,
        accession_number: S4_ACCESSION,
        force: { kind: "none" },
        successfulKeys: bothSucceeded(),
        gatedNoOpAccessions: new Set([S4_ACCESSION]),
      })
    ).toBe(true);
  });

  it("forces an extractor that is not the first one on the form", () => {
    expect(
      shouldReplaySpacFiling({
        form: S4,
        items: null,
        cik: CIK,
        accession_number: S4_ACCESSION,
        force: { kind: "extractors", ids: ["merger-proxy"] },
        successfulKeys: bothSucceeded(),
        gatedNoOpAccessions: NO_GATED,
      })
    ).toBe(true);
  });

  it("still skips a successful S-1 even when its accession is in the gated set", () => {
    // Only the known-SPAC-gated extractors record a no-op success; an S-1 that
    // succeeded really did mint the row, so the exemption must not reach it.
    expect(
      shouldReplaySpacFiling({
        form: "S-1",
        items: null,
        cik: CIK,
        accession_number: S1,
        force: { kind: "none" },
        successfulKeys: keysFor("S-1-xbrl", [S1]),
        gatedNoOpAccessions: new Set([S1]),
      })
    ).toBe(false);
  });
});
