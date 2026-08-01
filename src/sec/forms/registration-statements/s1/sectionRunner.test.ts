/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { makeRunSection, parseConfidenceFloor } from "./sectionRunner";

interface RecordedLetter {
  section_name: string;
  reason_code: string;
}

/** Minimal stub: runSection only calls `record` and `markResolved`. */
function stubDeadLetters(): {
  repo: ExtractionDeadLetterRepo;
  letters: RecordedLetter[];
  resolved: string[];
} {
  const letters: RecordedLetter[] = [];
  const resolved: string[] = [];
  const repo = {
    record: async (args: { section_name: string; reason_code: string }) => {
      letters.push({ section_name: args.section_name, reason_code: args.reason_code });
    },
    markResolved: async (_id: string, _acc: string, section: string) => {
      resolved.push(section);
    },
  } as unknown as ExtractionDeadLetterRepo;
  return { repo, letters, resolved };
}

describe("parseConfidenceFloor", () => {
  it("returns the fallback for undefined, empty, or non-numeric input", () => {
    expect(parseConfidenceFloor(undefined, 0.3)).toBe(0.3);
    expect(parseConfidenceFloor("", 0.3)).toBe(0.3);
    expect(parseConfidenceFloor("  ", 0.3)).toBe(0.3);
    expect(parseConfidenceFloor("abc", 0.3)).toBe(0.3);
  });
  it("parses a numeric floor", () => {
    expect(parseConfidenceFloor("0.8", 0)).toBe(0.8);
    expect(parseConfidenceFloor("0", 0.5)).toBe(0);
  });
});

describe("makeRunSection persist meta", () => {
  it("reports complete only when every extracted row survives filtering", async () => {
    const { repo } = stubDeadLetters();
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-meta",
      confidenceFloor: 0.5,
    });
    const seen: boolean[] = [];
    const run = (rows: Array<{ confidence: number; span: string }>) =>
      runSection({
        sectionName: "management",
        text: "verbatim span here",
        emptyDetail: "empty",
        lowConfidenceDetail: "low",
        verifyRow: (text, r) => text.includes(r.span),
        extract: async () => rows,
        persist: async (persisted, meta) => {
          seen.push(meta.complete);
          return persisted.length;
        },
      });

    // All rows survive -> complete.
    await run([{ confidence: 0.9, span: "verbatim span" }]);
    // One row dropped by the confidence floor -> incomplete.
    await run([
      { confidence: 0.9, span: "verbatim span" },
      { confidence: 0.1, span: "verbatim span" },
    ]);
    // One row dropped by span verification -> incomplete.
    await run([
      { confidence: 0.9, span: "verbatim span" },
      { confidence: 0.9, span: "not in the text" },
    ]);
    expect(seen).toEqual([true, false, false]);
  });
});

describe("makeRunSection confidenceFloor", () => {
  const baseRow = { confidence: 0.5, value: 1 };

  it("dead-letters LOW_CONFIDENCE_ALL when rows fall below an explicit floor", async () => {
    const { repo, letters } = stubDeadLetters();
    let persisted = 0;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      accession_number: "acc-1",
      confidenceFloor: 0.8,
    });
    await runSection<typeof baseRow>({
      sectionName: "merger",
      text: "some text",
      emptyDetail: "empty",
      lowConfidenceDetail: "all rows below confidence floor",
      extract: async () => [baseRow],
      persist: async () => {
        persisted++;
        return 1;
      },
    });
    expect(persisted).toBe(0);
    expect(letters).toEqual([{ section_name: "merger", reason_code: "LOW_CONFIDENCE_ALL" }]);
  });

  it("persists the same rows under the default floor (0)", async () => {
    const { repo, resolved } = stubDeadLetters();
    let persisted = 0;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      accession_number: "acc-2",
    });
    await runSection<typeof baseRow>({
      sectionName: "merger",
      text: "some text",
      emptyDetail: "empty",
      lowConfidenceDetail: "all rows below confidence floor",
      extract: async () => [baseRow],
      persist: async () => {
        persisted++;
        return 1;
      },
    });
    expect(persisted).toBe(1);
    expect(resolved).toEqual(["merger"]);
  });

  it("records a <section>-partial dead letter when some rows fail span verification", async () => {
    const { repo, letters, resolved } = stubDeadLetters();
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      accession_number: "acc-3",
    });
    await runSection<typeof baseRow>({
      sectionName: "merger",
      text: "keep drop",
      emptyDetail: "empty",
      lowConfidenceDetail: "low",
      unverifiedPartialDetail: "$N of $T dropped",
      extract: async () => [
        { confidence: 0.9, value: 1 },
        { confidence: 0.9, value: 2 },
      ],
      verifyRow: (_text, r) => r.value === 1, // drop value:2
      persist: async () => 1,
    });
    expect(resolved).toEqual(["merger"]); // base section resolved (survivors persisted)
    expect(letters).toContainEqual({
      section_name: "merger-partial",
      reason_code: "UNVERIFIED_SOURCE_SPAN",
    });
  });

  it("resolves a stale <section>-partial on a clean re-run (no drops)", async () => {
    const { repo, letters, resolved } = stubDeadLetters();
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "merger-proxy",
      extractor_version: "1.0.0",
      accession_number: "acc-4",
    });
    await runSection<typeof baseRow>({
      sectionName: "merger",
      text: "all good",
      emptyDetail: "empty",
      lowConfidenceDetail: "low",
      unverifiedPartialDetail: "$N of $T dropped",
      extract: async () => [{ confidence: 0.9, value: 1 }],
      verifyRow: () => true, // nothing dropped
      persist: async () => 1,
    });
    // No new -partial recorded, and the base + sibling -partial are resolved so
    // a previously-pending -partial cannot linger forever on the worklist.
    expect(letters).toEqual([]);
    expect(resolved).toEqual(["merger", "merger-partial"]);
  });
});
