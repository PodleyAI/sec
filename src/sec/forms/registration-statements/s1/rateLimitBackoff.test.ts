/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskAbortedError } from "workglow";
import {
  EXTRACTION_ATTEMPTS,
  MAX_RATE_LIMIT_WAIT_MS,
  RateLimitExhaustedError,
  extractManagement,
  isRateLimitError,
  rateLimitWaitMs,
  statedDelayMs,
} from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;

// Every extractManagement case below waits out at least one throttle, and the
// waits are seconds each. On real timers the file spent that time asleep for no
// added coverage; on fake timers the same schedule is driven deterministically.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup?.();
  cleanup = undefined;
});

/** The verbatim shape OpenAI returned during a live extraction batch. */
const OPENAI_THROTTLE =
  "Provider OPENAI failed for StructuredGenerationTask: Rate limit reached for " +
  "gpt-5.6-luna in organization org-abc on tokens per min (TPM): Limit 200000, " +
  "Used 178126, Requested 35481. Please try again in 4.082s.";

/**
 * A schema failure carrying the diagnostics wrapper's appended stack. The frame
 * `sectionExtractors.ts:429:15` is a line number, not an HTTP status — and the
 * frame naming `isRateLimitError` is not the phrase "rate limit".
 */
const SCHEMA_FAILURE_WITH_STACK =
  "The required property `confidence` is missing\n" +
  "    at extract (/repo/src/sec/forms/registration-statements/s1/sectionExtractors.ts:429:15)\n" +
  "    at isRateLimitError (/repo/src/sec/forms/registration-statements/s1/sectionExtractors.ts:201:10)";

describe("isRateLimitError", () => {
  // A throttle is retried WITHOUT spending an attempt, so each false positive
  // costs five extra billed calls plus the sleeping in between, and each false
  // negative burns the retry budget hammering a window that is closed.
  const ACCEPT: ReadonlyArray<[string, string]> = [
    ["the live OpenAI throttle", OPENAI_THROTTLE],
    ["a bare status line", "429 Too Many Requests"],
    ["an underscored provider code", "rate_limit_exceeded"],
    ["an HTTP-prefixed status", "HTTP 429"],
    ["a full status line", "HTTP/1.1 429 Too Many Requests"],
    ["a trailing-period status code", "Request failed with status code 429."],
    ["a JSON status field", '{"status":429,"message":"x"}'],
    ["a JSON code field", '{"code":429}'],
    ["a labelled error", "Error 429: rate limited"],
    ["a colon-separated status", "status: 429"],
    ["the SDK error shape", "AI_APICallError: status 429"],
  ];
  const REJECT: ReadonlyArray<[string, string]> = [
    ["a stack frame line number", "at extract (/a/sectionExtractors.ts:429:15)"],
    ["a quoted-back model value", "Invalid value: expected string, got 429"],
    // A share count or dollar figure with no throttle wording anywhere. The
    // digits alone must not carry the decision — "Rate limit ... 1,429,000"
    // stays a throttle, because the PHRASE is there and it really is one.
    ["a share count", 'Invalid value for "shares_owned": 1,429,000'],
    ["a dollar figure", "expected a number, got $429.50"],
    ["a row index", "schema validation failed at row 4290"],
    ["a token count", "tokens 4290"],
    ["a row expectation", "expected 429 rows"],
    ["a schema failure carrying an appended stack", SCHEMA_FAILURE_WITH_STACK],
  ];

  it.each(ACCEPT)("recognises %s", (_label, message) => {
    expect(isRateLimitError(new Error(message))).toBe(true);
  });

  it.each(REJECT)("does not read %s as a throttle", (_label, message) => {
    expect(isRateLimitError(new Error(message))).toBe(false);
  });

  it("does not treat a bad payload as a throttle", () => {
    expect(isRateLimitError(new Error("The required property `risks` is missing"))).toBe(false);
    expect(isRateLimitError(new Error("Unsupported parameter: 'temperature'"))).toBe(false);
  });

  it("does not read a 429 buried in a quoted figure as an HTTP status", () => {
    // Provider errors quote the model's own output back, and a throttle is
    // retried WITHOUT spending an attempt — so a misread turns one bad payload
    // into several extra billed calls plus minutes of sleeping.
    expect(isRateLimitError(new Error('Invalid value for "shares_owned": 1,429,000'))).toBe(false);
    expect(isRateLimitError(new Error("expected a number, got $429.50"))).toBe(false);
    expect(isRateLimitError(new Error("schema validation failed at row 4290"))).toBe(false);
  });
});

describe("statedDelayMs", () => {
  // The units providers actually emit. `8m38.4s` is what an OpenAI RPD limit
  // answers with; a seconds-only reader saw "no delay stated" there and fell
  // back to a one-second exponential base, so the whole wait budget came to 31
  // seconds against a limit measured in minutes.
  const CASES: ReadonlyArray<[string, number | null]> = [
    ["Please try again in 8m38.4s.", 518_400],
    ["Please try again in 4.082s.", 4_082],
    ["Rate limit reached. Please try again in 1h.", 3_600_000],
    ["Please try again in 90s", 90_000],
    ["Please try again in 2m", 120_000],
    ["Please try again in 1h30m5s", 5_405_000],
    ["Please try again in 500ms", 500],
    ["Retry after 30s", 30_000],
    ["retry-after: 12s", 12_000],
    ["429 Too Many Requests", null],
    ["Rate limit reached for gpt-5.6-luna", null],
  ];

  it.each(CASES)("parses %j", (message, expected) => {
    expect(statedDelayMs(message)).toBe(expected);
  });

  it("matches ms before m so a millisecond delay is not read as minutes", () => {
    expect(statedDelayMs("Please try again in 500ms")).toBe(500);
    expect(statedDelayMs("Please try again in 500m")).toBe(30_000_000);
  });
});

describe("rateLimitWaitMs", () => {
  it("honours the delay the provider states rather than guessing", () => {
    // "try again in 4.082s" -> 4082ms, plus a small margin, plus jitter.
    expect(rateLimitWaitMs(new Error(OPENAI_THROTTLE), 1, 0)).toBe(4332);
  });

  it("backs off exponentially when no delay is stated", () => {
    const err = new Error("429 Too Many Requests");
    expect(rateLimitWaitMs(err, 1, 0)).toBe(1000);
    expect(rateLimitWaitMs(err, 2, 0)).toBe(2000);
    expect(rateLimitWaitMs(err, 3, 0)).toBe(4000);
  });

  it("caps the un-stated backoff so a call cannot stall indefinitely", () => {
    expect(rateLimitWaitMs(new Error("429"), 20, 0)).toBe(MAX_RATE_LIMIT_WAIT_MS);
  });

  it("honours a sub-cap stated delay whole, margin included", () => {
    expect(rateLimitWaitMs(new Error("Please try again in 500ms"), 1, 0)).toBe(750);
  });

  it("caps a STATED delay too — a daily quota states minutes or hours", () => {
    // Honouring an RPD delay verbatim would park the section on a setTimeout
    // for the afternoon, which is what MAX_RATE_LIMIT_WAITS exists to rule out;
    // the wait is capped and the exhausted budget becomes a dead letter.
    for (const stated of ["8m38.4s", "1h", "2m", "90s"]) {
      expect(rateLimitWaitMs(new Error(`Please try again in ${stated}.`), 1, 0)).toBe(
        MAX_RATE_LIMIT_WAIT_MS
      );
    }
  });

  it("caps a STATED delay too — a daily quota states hours", () => {
    // An RPD/daily limit answers with a delay measured in hours. Honouring it
    // verbatim would park the section on a setTimeout for the afternoon, which
    // is exactly what MAX_RATE_LIMIT_WAITS is supposed to rule out.
    expect(rateLimitWaitMs(new Error("Rate limit. Please try again in 3600s."), 1, 0)).toBe(30_000);
  });

  it("adds jitter so sections throttled together do not wake together", () => {
    const err = new Error("429 Too Many Requests");
    expect(rateLimitWaitMs(err, 1, 0)).toBe(1000);
    expect(rateLimitWaitMs(err, 1, 0.998)).toBe(1499);
  });
});

describe("throttling does not consume the retry budget", () => {
  it("waits out a rate limit and still has its attempts left for real failures", async () => {
    // One throttle, then EXTRACTION_ATTEMPTS worth of genuinely bad payloads.
    // If the throttle consumed an attempt, the last good payload would never be
    // requested and the section would be lost to having merely been queued.
    const throttle = new Error("429 Too Many Requests. Please try again in 0.001s.");
    const { unregister, calls } = registerFakeStructuredProvider([
      throttle,
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Director"],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe",
          },
        ],
      },
    ]);
    cleanup = unregister;

    const pending = extractManagement("Jane Roe served as Director.", fakeS1Model());
    await vi.advanceTimersByTimeAsync(MAX_RATE_LIMIT_WAIT_MS);
    const rows = await pending;
    expect(rows.map((r) => r.full_name)).toEqual(["Jane Roe"]);
    // The throttled call plus the successful one.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(EXTRACTION_ATTEMPTS).toBeGreaterThan(0);
  });

  it("fails as a throttle, not a bad response, once the window never clears", async () => {
    // Falling through to the ordinary retry path here recorded an exhausted
    // quota under the version-gated invalid-output code, so recovering from a
    // transient window needed an extractor version bump.
    const throttle = new Error("429 Too Many Requests. Please try again in 0.001s.");
    const { unregister } = registerFakeStructuredProvider([throttle]);
    cleanup = unregister;

    const pending = extractManagement("Jane Roe served as Director.", fakeS1Model());
    const assertion = expect(pending).rejects.toBeInstanceOf(RateLimitExhaustedError);
    await vi.advanceTimersByTimeAsync(MAX_RATE_LIMIT_WAIT_MS * 10);
    await assertion;
    await expect(pending).rejects.toThrow(/429/);
  });

  it("abandons the budget up front when the stated delay outlasts it", async () => {
    // An OpenAI daily (RPD) limit answers with minutes. Every wait is capped at
    // MAX_RATE_LIMIT_WAIT_MS, so 8m38.4s cannot clear inside the whole budget
    // (5 x 30s): sleeping it out spends five waits, five more billed calls and
    // two and a half minutes of wall-clock to arrive at the same
    // RateLimitExhaustedError. Fail on the first one instead.
    const throttle = new Error(
      "Rate limit reached for gpt-5.6-luna in organization org-abc on requests per day " +
        "(RPD): Limit 10000, Used 10000. Please try again in 8m38.4s."
    );
    const { unregister, calls } = registerFakeStructuredProvider([throttle]);
    cleanup = unregister;

    const pending = extractManagement("Jane Roe served as Director.", fakeS1Model());
    const assertion = expect(pending).rejects.toBeInstanceOf(RateLimitExhaustedError);
    // Zero fake time passes: every throttle wait is at least seconds long, so
    // settling here means none was taken.
    await vi.advanceTimersByTimeAsync(0);
    await assertion;
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    // The dead-letter detail keeps the provider's own wording AND says how long
    // the window was stated to be, so an operator knows when to retry.
    await expect(pending).rejects.toThrow(/8m38\.4s/);
    await expect(pending).rejects.toThrow(/518/);
  });

  it("still waits out a stated delay that fits inside the budget", async () => {
    // 2m is under 5 x 30s, so the window can plausibly clear: the early exit
    // must not swallow a recoverable throttle.
    const throttle = new Error("429 Too Many Requests. Please try again in 2m.");
    const { unregister, calls } = registerFakeStructuredProvider([
      throttle,
      {
        people: [
          {
            full_name: "Jane Roe",
            titles: ["Director"],
            relationship: null,
            confidence: 0.9,
            source_span: "Jane Roe",
          },
        ],
      },
    ]);
    cleanup = unregister;

    const pending = extractManagement("Jane Roe served as Director.", fakeS1Model());
    await vi.advanceTimersByTimeAsync(MAX_RATE_LIMIT_WAIT_MS * 2);
    const rows = await pending;
    expect(rows.map((r) => r.full_name)).toEqual(["Jane Roe"]);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it("surfaces a Ctrl-C during a throttle wait as a cancellation", async () => {
    // Rethrowing the 429 instead made the section record a version-gated dead
    // letter and return normally, so the sweep carried on dead-lettering every
    // remaining section of a filing the operator had already interrupted.
    const throttle = new Error("429 Too Many Requests. Please try again in 5s.");
    const { unregister, calls } = registerFakeStructuredProvider([throttle]);
    cleanup = unregister;

    const controller = new AbortController();
    const context = {
      signal: controller.signal,
      updateProgress: async () => {},
      own: <T>(t: T): T => t,
    } as never;

    const pending = extractManagement("Jane Roe served as Director.", fakeS1Model(), context);
    const assertion = expect(pending).rejects.toBeInstanceOf(TaskAbortedError);
    // Let the first call fail and the wait start, then cancel mid-wait.
    await vi.advanceTimersByTimeAsync(100);
    const callsBeforeAbort = calls.length;
    controller.abort();
    await vi.advanceTimersByTimeAsync(MAX_RATE_LIMIT_WAIT_MS * 2);
    await assertion;
    expect(calls.length).toBe(callsBeforeAbort);
  });
});
