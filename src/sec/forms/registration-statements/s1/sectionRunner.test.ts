/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { SecCliConfigurationError } from "../../../../config/EnvToDI";
import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { TaskAbortedError } from "workglow";
import { RateLimitExhaustedError } from "./sectionExtractors";
import { VERIFICATION_ATTEMPTS, makeRunSection, parseConfidenceFloor } from "./sectionRunner";

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

  it("re-asks when every confident row fails span verification, and keeps the retry's rows", async () => {
    // Live behavior this guards: the same correct underwriter came back with a
    // malformed citation on one run and a verbatim one on the next.
    const { repo, letters, resolved } = stubDeadLetters();
    let call = 0;
    const persisted: string[] = [];
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-retry",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: (text, r) => text.includes(r.span),
      extract: async () => {
        call++;
        return call === 1
          ? [{ confidence: 0.9, span: "a span welded across a gap" }]
          : [{ confidence: 0.9, span: "Citigroup Global Markets Inc." }];
      },
      persist: async (rows) => {
        persisted.push(...rows.map((r) => r.span));
        return rows.length;
      },
    });

    expect(call).toBe(2);
    expect(persisted).toEqual(["Citigroup Global Markets Inc."]);
    expect(letters).toEqual([]);
    expect(resolved).toContain("underwriters");
  });

  it("stops re-asking after VERIFICATION_ATTEMPTS and dead-letters", async () => {
    const { repo, letters } = stubDeadLetters();
    let call = 0;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-give-up",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: (text, r) => text.includes(r.span),
      extract: async () => {
        call++;
        return [{ confidence: 0.9, span: "never present" }];
      },
      persist: async () => 0,
    });

    expect(call).toBe(VERIFICATION_ATTEMPTS);
    expect(letters[0]?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
  });

  it("does not re-ask an empty response", async () => {
    const { repo } = stubDeadLetters();
    let call = 0;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-empty",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Some text.",
      emptyDetail: "none returned",
      lowConfidenceDetail: "low",
      verifyRow: (text, r) => text.includes(r.span),
      extract: async () => {
        call++;
        return [];
      },
      persist: async () => 0,
    });
    expect(call).toBe(1);
  });
});

describe("makeRunSection configuration errors", () => {
  it("propagates a SecCliConfigurationError instead of dead-lettering it", async () => {
    // A malformed SEC_EXTRACTION_TEMPERATURE is wrong for every section of
    // every filing. Recorded as MODEL_INVALID_OUTPUT it would stamp a
    // version-gated entry across the whole corpus that no version bump can
    // clear, and the operator would never see the message naming the variable.
    const { repo, letters, resolved } = stubDeadLetters();
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-config",
    });

    await expect(
      runSection<{ confidence: number; span: string }>({
        sectionName: "management",
        text: "Some text.",
        emptyDetail: "none returned",
        lowConfidenceDetail: "low",
        verifyRow: (text, r) => text.includes(r.span),
        extract: async () => {
          throw new SecCliConfigurationError("SEC_EXTRACTION_TEMPERATURE is not a number");
        },
        persist: async () => 0,
      })
    ).rejects.toThrow(SecCliConfigurationError);

    expect(letters).toEqual([]);
    expect(resolved).toEqual([]);
  });
});

describe("makeRunSection failure classification", () => {
  const run = (
    opts: { readonly signal?: AbortSignal },
    thrown: unknown
  ): { promise: Promise<void>; letters: RecordedLetter[] } => {
    const { repo, letters } = stubDeadLetters();
    const promise = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-classify",
      ...opts,
    })<{ confidence: number }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      extract: async () => {
        throw thrown;
      },
      persist: async () => 0,
    });
    return { promise, letters };
  };

  it("records an exhausted throttle as RATE_LIMITED, not a version-gated bug", async () => {
    const { promise, letters } = run({}, new RateLimitExhaustedError(5, new Error("HTTP 429")));
    await promise;
    expect(letters).toEqual([{ section_name: "underwriters", reason_code: "RATE_LIMITED" }]);
  });

  it("propagates a TaskAbortedError instead of dead-lettering it", async () => {
    // Ctrl-C must reach the filing pipeline, which abandons the filing. Turning
    // it into a dead letter left the sweep grinding and stamped version-gated
    // failures on sections that were merely interrupted.
    const { promise, letters } = run({}, new TaskAbortedError());
    await expect(promise).rejects.toBeInstanceOf(TaskAbortedError);
    expect(letters).toEqual([]);
  });

  it("treats any failure raised under an already-aborted signal as cancellation", async () => {
    // A provider call torn down mid-abort reports whatever transport error it
    // happened to hit; the signal, not the error's shape, is what says the
    // filing was interrupted.
    const controller = new AbortController();
    controller.abort();
    const cause = new Error("socket hang up");
    const { promise, letters } = run({ signal: controller.signal }, cause);
    await expect(promise).rejects.toBeInstanceOf(TaskAbortedError);
    await expect(promise).rejects.toMatchObject({ cause });
    expect(letters).toEqual([]);
  });

  it("still dead-letters a real failure when nothing was aborted", async () => {
    const controller = new AbortController();
    const { promise, letters } = run(
      { signal: controller.signal },
      new Error("The required property `confidence` is missing")
    );
    await promise;
    expect(letters).toEqual([
      { section_name: "underwriters", reason_code: "MODEL_INVALID_OUTPUT" },
    ]);
  });
});
