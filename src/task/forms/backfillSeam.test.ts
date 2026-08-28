/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  clearRegisteredBackfillDescriptorsForTesting,
  getBackfillDescriptor,
  listBackfillableExtractorIds,
  registerBackfillDescriptor,
} from "./backfillDescriptors";
import { runExtractorBackfill } from "./BackfillExtractorTask";

// Deliberately registers nothing at module scope: this file is what a
// deployment of this package ALONE looks like, and the point of it is what
// `sec extractor backfill` answers there.

afterEach(() => clearRegisteredBackfillDescriptorsForTesting());

describe("an extractor id whose reading is supplied elsewhere", () => {
  it("is still offered for completion and still holds a version slot", () => {
    // The ids stay listed because this package holds their state — dead
    // letters, run rows and stored tables outlive whether it ships the
    // extractor, and an id with rows and no version slot is unreadable.
    for (const id of ["redemption", "loi", "S-1", "424"]) {
      expect(listBackfillableExtractorIds()).toContain(id);
    }
  });

  it("resolves to no descriptor", () => {
    for (const id of ["redemption", "loi", "S-1", "424"]) {
      expect(getBackfillDescriptor(id), `${id} must have no wiring here`).toBeUndefined();
    }
  });

  it("refuses rather than selecting zero filings and reporting success", async () => {
    for (const id of ["redemption", "loi"]) {
      await expect(
        runExtractorBackfill({
          extractorId: id,
          force: false,
          dryRun: true,
          processFiling: async () => {
            throw new Error("must not reach a filing");
          },
        })
      ).rejects.toThrow(
        new RegExp(`Cannot backfill '${id}': this deployment registers no backfill wiring`)
      );
    }
  });

  it("says something different for an id nobody has heard of", async () => {
    // A typo is not the same answer as an extractor supplied elsewhere, and the
    // list of ids is the useful reply only to the typo.
    await expect(
      runExtractorBackfill({
        extractorId: "redemptionn",
        force: false,
        dryRun: true,
        processFiling: async () => {},
      })
    ).rejects.toThrow(/No backfill wiring for extractor 'redemptionn'/);
  });
});

describe("a contributed descriptor", () => {
  it("makes the id backfillable and is what the sweep runs", async () => {
    registerBackfillDescriptor({
      extractorId: "redemption",
      selectCandidates: async () => [
        { cik: 5, accession_number: "acc-a" },
        { cik: 5, accession_number: "acc-b" },
      ],
      filterTodo: async (candidates) => candidates.filter((c) => c.accession_number === "acc-b"),
    });

    expect(getBackfillDescriptor("redemption")).toBeDefined();

    const processed: string[] = [];
    const out = await runExtractorBackfill({
      extractorId: "redemption",
      force: false,
      dryRun: false,
      processFiling: async (accession) => {
        processed.push(accession);
      },
    });
    expect(out).toEqual({ selected: 2, processed: 1, skipped: 1 });
    expect(processed).toEqual(["acc-b"]);
  });

  it("wins over a descriptor this package ships for the same id", () => {
    registerBackfillDescriptor({
      extractorId: "merger-proxy",
      selectCandidates: async () => [],
    });
    // The built-in carries a `filterTodo`; the contributed one deliberately
    // does not, so resolving to the contributed one is observable.
    expect(getBackfillDescriptor("merger-proxy")?.filterTodo).toBeUndefined();
    clearRegisteredBackfillDescriptorsForTesting();
    expect(getBackfillDescriptor("merger-proxy")?.filterTodo).toBeDefined();
  });
});
