/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { SecCliConfigurationError } from "../../../../config/EnvToDI";
import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { TaskAbortedError } from "workglow";
import { MixedRiskCaptionShapeError, RateLimitExhaustedError } from "./sectionExtractors";
import {
  MIXED_SHAPE_REASK_ATTEMPTS,
  VERIFICATION_ATTEMPTS,
  makeRunSection,
  parseConfidenceFloor,
} from "./sectionRunner";

interface RecordedLetter {
  section_name: string;
  reason_code: string;
}

/** Minimal stub: runSection only calls `record` and `markResolved`. */
function stubDeadLetters(): {
  repo: ExtractionDeadLetterRepo;
  letters: RecordedLetter[];
  /** Details kept alongside, so the letter assertions stay shape-exact. */
  details: (string | null)[];
  resolved: string[];
} {
  const letters: RecordedLetter[] = [];
  const details: (string | null)[] = [];
  const resolved: string[] = [];
  const repo = {
    record: async (args: { section_name: string; reason_code: string; detail: string | null }) => {
      letters.push({ section_name: args.section_name, reason_code: args.reason_code });
      details.push(args.detail);
    },
    markResolved: async (_id: string, _acc: string, section: string) => {
      resolved.push(section);
    },
  } as unknown as ExtractionDeadLetterRepo;
  return { repo, letters, details, resolved };
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

  it("names the rejected source_span in the UNVERIFIED_SOURCE_SPAN detail", async () => {
    // Offering-terms / promote wipe with a paraphrase: the worklist used to
    // say only "all 1 confident rows had source_span not present", so the
    // next fixture could never be the rejected quote itself.
    const { repo, letters, details } = stubDeadLetters();
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "424",
      extractor_version: "1.0.0",
      accession_number: "acc-span-detail",
    });
    const rejected = "a paraphrase the section does not contain at all";
    await runSection<{ confidence: number; source_span: string }>({
      sectionName: "offering-terms",
      text: "We are offering 20,000,000 units at $10.00 per unit.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: (text, r) => text.includes(r.source_span),
      extract: async () => [{ confidence: 0.9, source_span: rejected }],
      persist: async () => 0,
    });

    expect(letters[0]?.reason_code).toBe("UNVERIFIED_SOURCE_SPAN");
    expect(details[0]).toContain(rejected);
  });

  it("re-asks a MixedRiskCaptionShapeError and keeps the retry's rows", async () => {
    // `extract` THROWS this one rather than returning rows, so before the fix
    // it escaped the re-ask loop entirely and went straight to the catch — the
    // one recoverable response-shape failure in this file that got zero
    // re-asks, on by far the most expensive section to re-run. The heading echo
    // that causes it is a property of one generation, not of the section.
    const { repo, letters, resolved } = stubDeadLetters();
    let call = 0;
    const persisted: string[] = [];
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-mixed-retry",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "Risk Factors",
      text: "We may be unable to complete a business combination.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      verifyRow: (text, r) => text.includes(r.span),
      extract: async () => {
        call++;
        if (call === 1) throw new MixedRiskCaptionShapeError(4, 20);
        return [{ confidence: 0.9, span: "We may be unable to complete a business combination." }];
      },
      persist: async (rows) => {
        persisted.push(...rows.map((r) => r.span));
        return rows.length;
      },
    });

    expect(call).toBe(2);
    expect(persisted).toEqual(["We may be unable to complete a business combination."]);
    expect(letters).toEqual([]);
    expect(resolved).toContain("Risk Factors");
  });

  it("dead-letters MIXED_CAPTION_SHAPE once every re-ask has been spent", async () => {
    // The bound: a section that is mixed on every attempt is a real
    // ambiguity and belongs on the worklist, not in an endless re-ask.
    //
    // It is its OWN bound, smaller than the span-verification one. A malformed
    // citation varies run to run, so a third ask can genuinely produce a
    // different one; a mixed shape re-asks a byte-identical prompt under greedy
    // decoding, where only provider-side batching can change the answer — and
    // each ask on this path re-enumerates the largest section in the filing.
    // For a 7-chunk section this is the difference between 42 and 63 calls.
    const { repo, letters, details } = stubDeadLetters();
    let call = 0;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-mixed-final",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "Risk Factors",
      text: "Some risk prose.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      extract: async () => {
        call++;
        throw new MixedRiskCaptionShapeError(4, 20);
      },
      persist: async () => 0,
    });

    expect(call).toBe(MIXED_SHAPE_REASK_ATTEMPTS);
    expect(MIXED_SHAPE_REASK_ATTEMPTS).toBeLessThan(VERIFICATION_ATTEMPTS);
    expect(letters).toEqual([{ section_name: "Risk Factors", reason_code: "MIXED_CAPTION_SHAPE" }]);
    // The entry says what the re-ask cost, so the worklist does not read as a
    // single unlucky generation.
    expect(details[0]).toContain(`unchanged after ${MIXED_SHAPE_REASK_ATTEMPTS} attempt(s)`);
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

  it("tries emptyExtracts when the primary extract returns [] and keeps the first non-empty", async () => {
    const { repo, letters, resolved } = stubDeadLetters();
    const calls: string[] = [];
    const persisted: string[] = [];
    let modelIndex = -1;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-empty-fallback",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "no underwriters returned",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: (text, r) => text.includes(r.span),
      extract: async () => {
        calls.push("primary");
        return [];
      },
      emptyExtracts: [
        async () => {
          calls.push("fallback");
          return [{ confidence: 0.9, span: "Citigroup Global Markets Inc." }];
        },
      ],
      modelIds: ["claude-sonnet-5", "claude-haiku-4-5"],
      persist: async (rows, meta) => {
        persisted.push(...rows.map((r) => r.span));
        modelIndex = meta.modelIndex;
        return rows.length;
      },
    });

    expect(calls).toEqual(["primary", "fallback"]);
    expect(persisted).toEqual(["Citigroup Global Markets Inc."]);
    expect(modelIndex).toBe(1);
    expect(letters).toEqual([]);
    expect(resolved).toContain("underwriters");
  });

  it("does not spend verification attempts on empty fallbacks, then dead-letters MODEL_EMPTY naming every tried id", async () => {
    const { repo, letters, details } = stubDeadLetters();
    let primary = 0;
    let fallback = 0;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-empty-all",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "no underwriters returned",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: () => true,
      extract: async () => {
        primary++;
        return [];
      },
      emptyExtracts: [
        async () => {
          fallback++;
          return [];
        },
      ],
      modelIds: ["claude-sonnet-5", "claude-haiku-4-5"],
      persist: async () => 0,
    });

    expect(primary).toBe(1);
    expect(fallback).toBe(1);
    expect(letters).toHaveLength(1);
    expect(letters[0]?.reason_code).toBe("MODEL_EMPTY");
    expect(details[0]).toBe("no underwriters returned (tried claude-sonnet-5, claude-haiku-4-5)");
  });

  it("does not try emptyExtracts on [] when fallbackOnEmpty is false", async () => {
    const { repo, letters } = stubDeadLetters();
    const calls: string[] = [];
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "redemption",
      extractor_version: "1.1.0",
      accession_number: "acc-empty-no-fallback",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "redemption",
      text: "The Company announced the closing of its initial business combination.",
      emptyDetail: "no redemption returned",
      lowConfidenceDetail: "low",
      fallbackOnEmpty: false,
      extract: async () => {
        calls.push("primary");
        return [];
      },
      emptyExtracts: [
        async () => {
          calls.push("fallback");
          return [{ confidence: 0.9, span: "closing of its initial business combination" }];
        },
      ],
      modelIds: ["gpt-5.6-luna", "grok-4.6"],
      persist: async () => 0,
    });

    expect(calls).toEqual(["primary"]);
    expect(letters).toEqual([{ section_name: "redemption", reason_code: "MODEL_EMPTY" }]);
  });

  it("tries emptyExtracts on throw even when fallbackOnEmpty is false", async () => {
    const { repo, letters, resolved } = stubDeadLetters();
    const calls: string[] = [];
    const persisted: string[] = [];
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "redemption",
      extractor_version: "1.1.0",
      accession_number: "acc-throw-still-fallback",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "redemption",
      text: "Holders of 1,000,000 shares exercised their redemption rights.",
      emptyDetail: "no redemption returned",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: (text, r) => text.includes(r.span),
      fallbackOnEmpty: false,
      extract: async () => {
        calls.push("primary");
        throw new Error("Provider OPENAI failed: 400 no credits remaining");
      },
      emptyExtracts: [
        async () => {
          calls.push("fallback");
          return [{ confidence: 0.9, span: "1,000,000 shares" }];
        },
      ],
      modelIds: ["gpt-5.6-luna", "grok-4.6"],
      persist: async (rows) => {
        persisted.push(...rows.map((r) => r.span));
        return rows.length;
      },
    });

    expect(calls).toEqual(["primary", "fallback"]);
    expect(persisted).toEqual(["1,000,000 shares"]);
    expect(letters).toEqual([]);
    expect(resolved).toContain("redemption");
  });

  it("tries emptyExtracts when the primary extract throws a provider error", async () => {
    const { repo, letters, resolved } = stubDeadLetters();
    const calls: string[] = [];
    const persisted: string[] = [];
    let modelIndex = -1;
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-throw-fallback",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "no underwriters returned",
      lowConfidenceDetail: "low",
      unverifiedAllDetail: "all $T unverified",
      verifyRow: (text, r) => text.includes(r.span),
      extract: async () => {
        calls.push("primary");
        throw new Error("Provider OPENAI failed: 400 no credits remaining");
      },
      emptyExtracts: [
        async () => {
          calls.push("fallback");
          return [{ confidence: 0.9, span: "Citigroup Global Markets Inc." }];
        },
      ],
      modelIds: ["gpt-5.6-luna", "grok-4.6"],
      persist: async (rows, meta) => {
        persisted.push(...rows.map((r) => r.span));
        modelIndex = meta.modelIndex;
        return rows.length;
      },
    });

    expect(calls).toEqual(["primary", "fallback"]);
    expect(persisted).toEqual(["Citigroup Global Markets Inc."]);
    expect(modelIndex).toBe(1);
    expect(letters).toEqual([]);
    expect(resolved).toContain("underwriters");
  });

  it("does not try emptyExtracts when the primary extract is aborted", async () => {
    const { repo, letters } = stubDeadLetters();
    const calls: string[] = [];
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-abort-fallback",
    });

    await expect(
      runSection<{ confidence: number; span: string }>({
        sectionName: "underwriters",
        text: "Citigroup Global Markets Inc. is the underwriter.",
        emptyDetail: "none",
        lowConfidenceDetail: "low",
        extract: async () => {
          calls.push("primary");
          throw new TaskAbortedError();
        },
        emptyExtracts: [
          async () => {
            calls.push("fallback");
            return [{ confidence: 0.9, span: "Citigroup Global Markets Inc." }];
          },
        ],
        persist: async () => 0,
      })
    ).rejects.toBeInstanceOf(TaskAbortedError);

    expect(calls).toEqual(["primary"]);
    expect(letters).toEqual([]);
  });

  it("dead-letters the last fallback error when every extract throws", async () => {
    const { repo, letters, details } = stubDeadLetters();
    const runSection = makeRunSection({
      deadLetters: repo,
      extractor_id: "S-1",
      extractor_version: "1.0.0",
      accession_number: "acc-all-throw",
    });
    await runSection<{ confidence: number; span: string }>({
      sectionName: "underwriters",
      text: "Citigroup Global Markets Inc. is the underwriter.",
      emptyDetail: "none",
      lowConfidenceDetail: "low",
      extract: async () => {
        throw new Error("primary: no credits remaining");
      },
      emptyExtracts: [
        async () => {
          throw new Error("fallback: provider unavailable");
        },
      ],
      persist: async () => 0,
    });

    expect(letters).toEqual([
      { section_name: "underwriters", reason_code: "MODEL_INVALID_OUTPUT" },
    ]);
    expect(details[0]).toBe("fallback: provider unavailable");
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
  ): { promise: Promise<unknown>; letters: RecordedLetter[] } => {
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

describe("makeRunSection outcome", () => {
  const runner = (accession: string) => {
    const { repo, letters } = stubDeadLetters();
    return {
      letters,
      runSection: makeRunSection({
        deadLetters: repo,
        extractor_id: "merger-proxy",
        extractor_version: "1.0.0",
        accession_number: accession,
      }),
    };
  };

  it("reports the reason a section dead-lettered, so a caller can tell a verdict from a failure", async () => {
    // The distinction the merger-proxy gate reads: MODEL_EMPTY is the model
    // saying the document discloses nothing, while MODEL_INVALID_OUTPUT is the
    // catch-all for a run that never reached an answer. Both leave zero rows.
    const { runSection } = runner("acc-outcome");
    const base = {
      sectionName: "merger",
      text: "Some merger prose.",
      emptyDetail: "empty",
      lowConfidenceDetail: "low",
      persist: async () => 1,
    };

    expect(await runSection<{ confidence: number }>({ ...base, extract: async () => [] })).toEqual({
      status: "dead-lettered",
      reason: "MODEL_EMPTY",
    });
    expect(
      await runSection<{ confidence: number }>({
        ...base,
        extract: async () => {
          throw new Error("upstream provider failure");
        },
      })
    ).toEqual({ status: "dead-lettered", reason: "MODEL_INVALID_OUTPUT" });
    expect(
      await runSection<{ confidence: number }>({
        ...base,
        text: undefined,
        extract: async () => [],
      })
    ).toEqual({ status: "dead-lettered", reason: "SECTION_NOT_FOUND" });
  });

  it("reports persisted and skipped runs", async () => {
    const { runSection } = runner("acc-outcome-ok");
    const base = {
      sectionName: "merger",
      text: "Some merger prose.",
      emptyDetail: "empty",
      lowConfidenceDetail: "low",
      extract: async () => [{ confidence: 0.9 }],
      persist: async () => 1,
    };
    expect(await runSection<{ confidence: number }>(base)).toEqual({ status: "persisted" });
    expect(await runSection<{ confidence: number }>({ ...base, skip: true })).toEqual({
      status: "skipped",
    });
  });
});
