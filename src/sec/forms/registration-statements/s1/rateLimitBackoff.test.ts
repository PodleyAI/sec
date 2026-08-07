/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  EXTRACTION_ATTEMPTS,
  extractManagement,
  isRateLimitError,
  rateLimitWaitMs,
} from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/** The verbatim shape OpenAI returned during a live extraction batch. */
const OPENAI_THROTTLE =
  "Provider OPENAI failed for StructuredGenerationTask: Rate limit reached for " +
  "gpt-5.6-luna in organization org-abc on tokens per min (TPM): Limit 200000, " +
  "Used 178126, Requested 35481. Please try again in 4.082s.";

describe("isRateLimitError", () => {
  it("recognises the live OpenAI throttle", () => {
    expect(isRateLimitError(new Error(OPENAI_THROTTLE))).toBe(true);
  });

  it("recognises other common phrasings", () => {
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("rate_limit_exceeded"))).toBe(true);
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

describe("rateLimitWaitMs", () => {
  it("honours the delay the provider states rather than guessing", () => {
    // "try again in 4.082s" -> 4082ms, plus a small margin, plus jitter.
    const ms = rateLimitWaitMs(new Error(OPENAI_THROTTLE), 1, 0);
    expect(ms).toBe(4332);
  });

  it("backs off exponentially when no delay is stated", () => {
    const err = new Error("429 Too Many Requests");
    expect(rateLimitWaitMs(err, 1, 0)).toBe(1000);
    expect(rateLimitWaitMs(err, 2, 0)).toBe(2000);
    expect(rateLimitWaitMs(err, 3, 0)).toBe(4000);
  });

  it("caps the un-stated backoff so a call cannot stall indefinitely", () => {
    expect(rateLimitWaitMs(new Error("429"), 20, 0)).toBe(30_000);
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

    const rows = await extractManagement("Jane Roe served as Director.", fakeS1Model());
    expect(rows.map((r) => r.full_name)).toEqual(["Jane Roe"]);
    // The throttled call plus the successful one.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(EXTRACTION_ATTEMPTS).toBeGreaterThan(0);
  });

  it("still gives up once the throttle never clears", async () => {
    const throttle = new Error("429 Too Many Requests. Please try again in 0.001s.");
    const { unregister } = registerFakeStructuredProvider([throttle]);
    cleanup = unregister;
    await expect(extractManagement("Jane Roe served as Director.", fakeS1Model())).rejects.toThrow(
      /429/
    );
  }, 30_000);
});
