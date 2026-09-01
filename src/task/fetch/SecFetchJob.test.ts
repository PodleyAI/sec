/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import "workglow";
import type { FetchUrlTaskInput, RateLimiter, SafeFetchFn } from "workglow";
import { registerSafeFetch, RetryableJobError } from "workglow";
import { SecFetchMaxConcurrent, SecUserAgent } from "../../config/Constants";
import {
  installEdgarBlockTranslation,
  isEdgarRateLimitBody,
  resetEdgarBlockTranslationForTesting,
} from "./edgarBlockResponse";
import { SecFetchJob } from "./SecFetchJob";
import { resetSecFetchThrottleForTesting, setSecFetchLimiter } from "./secFetchThrottle";

/** A 200 whose body errors part-way through, i.e. a mid-body socket reset. */
function bodyFailsMidStream(): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 3) {
        controller.error(new Error("socket hang up"));
        return;
      }
      sent += 1;
      controller.enqueue(Uint8Array.from([sent]));
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/octet-stream" },
  });
}

const noopContext = {
  signal: new AbortController().signal,
  updateProgress: async () => {},
};

function expectRetryable(error: unknown): RetryableJobError {
  expect(error).toBeInstanceOf(RetryableJobError);
  const retryable = error as RetryableJobError;
  expect(retryable.retryable).toBe(true);
  return retryable;
}

/** `retryDate` is this many ms from now, within slack (execute returns immediately). */
function expectRetryWaitMs(error: RetryableJobError, expectedMs: number, slackMs = 1_500): void {
  expect(error.retryDate).toBeInstanceOf(Date);
  const wait = error.retryDate!.getTime() - Date.now();
  expect(wait).toBeGreaterThan(expectedMs - slackMs);
  expect(wait).toBeLessThan(expectedMs + slackMs);
}

describe("SecFetchJob", () => {
  it("merges SEC User-Agent onto job input", () => {
    const input: FetchUrlTaskInput = {
      url: "https://data.sec.gov/submissions/CIK0000320193.json",
      response_type: "json",
    };
    const job = new SecFetchJob({ input });
    expect(job.input.headers?.["User-Agent"]).toBe(SecUserAgent);
  });

  it("lets caller headers extend defaults without replacing unrelated keys", () => {
    const input: FetchUrlTaskInput = {
      url: "https://example.com/",
      headers: { Accept: "application/json" },
      response_type: "json",
    };
    const job = new SecFetchJob({ input });
    expect(job.input.headers?.["User-Agent"]).toBe(SecUserAgent);
    expect(job.input.headers?.Accept).toBe("application/json");
  });

  // TODO: this wire-level test uses Bun.serve for a loopback listener. Swap
  // for node:http.createServer so both runtimes drive it, then drop the skip.
  it.skipIf(typeof Bun === "undefined")(
    "sends User-Agent on the wire for loopback requests",
    async () => {
      let seenUa: string | null = null;
      const server = Bun.serve({
        port: 0,
        fetch(req) {
          seenUa = req.headers.get("user-agent");
          return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
            status: 200,
            headers: { "Content-Type": "application/zip" },
          });
        },
      });

      try {
        const url = `http://127.0.0.1:${server.port}/fake.zip`;
        const job = new SecFetchJob({
          input: { url, response_type: "blob" } satisfies FetchUrlTaskInput,
        });
        await job.execute(job.input, {
          signal: AbortSignal.timeout(15_000),
          updateProgress: async () => {},
        });
        expect(seenUa).toBe(SecUserAgent);
      } finally {
        server.stop();
      }
    }
  );

  // TODO: retry-behaviour tests use Bun.serve for a loopback listener. Swap for
  // node:http.createServer so both runtimes drive them, then drop the skip.
  describe.skipIf(typeof Bun === "undefined")("retry behavior", () => {
    it("throws RetryableJobError on 429 after one attempt so the queue reschedules", async () => {
      let attempts = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          attempts++;
          return new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "0" },
          });
        },
      });
      try {
        const url = `http://127.0.0.1:${server.port}/x.json`;
        const job = new SecFetchJob({
          input: { url, response_type: "json" } satisfies FetchUrlTaskInput,
        });
        const error = await job.execute(job.input, noopContext).catch((e: unknown) => e);
        expect(attempts).toBe(1);
        expectRetryWaitMs(expectRetryable(error), 0);
      } finally {
        server.stop();
      }
    }, 15_000);

    it("throws RetryableJobError on 5xx after one attempt so the queue reschedules", async () => {
      let attempts = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          attempts++;
          return new Response("boom", { status: 503 });
        },
      });
      try {
        const url = `http://127.0.0.1:${server.port}/x.json`;
        const job = new SecFetchJob({
          input: { url, response_type: "json" } satisfies FetchUrlTaskInput,
        });
        const error = await job.execute(job.input, noopContext).catch((e: unknown) => e);
        expect(attempts).toBe(1);
        expectRetryable(error);
      } finally {
        server.stop();
      }
    }, 15_000);

    it("does not retry on 404 (non-retriable) and fails fast", async () => {
      let attempts = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          attempts++;
          return new Response("not found", { status: 404 });
        },
      });
      try {
        const url = `http://127.0.0.1:${server.port}/missing.json`;
        const job = new SecFetchJob({
          input: { url, response_type: "json" } satisfies FetchUrlTaskInput,
        });
        await expect(
          job.execute(job.input, {
            signal: new AbortController().signal,
            updateProgress: async () => {},
          })
        ).rejects.toBeDefined();
        expect(attempts).toBe(1);
      } finally {
        server.stop();
      }
    }, 10_000);
  });

  // A hostile Retry-After: 86400 used to park this job on a setTimeout for a
  // day. FetchUrlJob already puts that date on RetryableJobError.retryDate;
  // we cap it so the queue cannot hide the job for a day.
  describe("Retry-After cap", () => {
    afterEach(() => {
      resetSecFetchThrottleForTesting();
    });

    it("caps a huge Retry-After on the thrown retryDate, and does not re-issue", async () => {
      let attempts = 0;
      const previous = registerSafeFetch((async () => {
        attempts += 1;
        return new Response("rate limited", {
          status: 429,
          headers: { "Retry-After": "86400" },
        });
      }) as unknown as SafeFetchFn);
      try {
        const job = new SecFetchJob({
          input: {
            url: "https://www.sec.gov/Archives/edgar/x.json",
            response_type: "json",
          } satisfies FetchUrlTaskInput,
        });
        const error = await job.execute(job.input, noopContext).catch((e: unknown) => e);
        expect(attempts).toBe(1);
        expectRetryWaitMs(expectRetryable(error), 600_000, 2_000);
      } finally {
        registerSafeFetch(previous);
      }
    });
  });

  // Workglow marks a mid-body failure non-retryable once bytes have reached a
  // stream receiver, because the consumer's subscription outlives the attempt
  // and a re-issue from byte 0 would concatenate onto the partial body. A
  // timeout abort keeps its own shape through that classification, so this
  // execute() latches delivery itself and rethrows rather than wrapping as
  // retryable.
  describe("post-delivery retry ban", () => {
    it("does not re-issue a mid-body failure once bytes reached a receiver", async () => {
      let attempts = 0;
      const previous = registerSafeFetch((async () => {
        attempts += 1;
        return bodyFailsMidStream();
      }) as unknown as SafeFetchFn);
      try {
        const job = new SecFetchJob({
          input: {
            url: "https://www.sec.gov/Archives/edgar/big.tar.gz",
            response_type: "stream",
          } satisfies FetchUrlTaskInput,
        });
        const error = await job
          .execute(job.input, {
            signal: new AbortController().signal,
            updateProgress: async () => {},
            emitStreamEvent: async () => {},
          })
          .catch((e: unknown) => e);

        expect(attempts).toBe(1);
        expect((error as { code?: string }).code).toBe("FETCH_BODY_TRUNCATED");
        expect((error as { retryable?: boolean }).retryable).toBe(false);
      } finally {
        registerSafeFetch(previous);
      }
    }, 20_000);

    // The complement: with no stream receiver nothing was delivered, so the
    // failure stays retryable. execute() does not re-issue; the queue will.
    it("throws RetryableJobError for a mid-body failure when nothing received the bytes", async () => {
      let attempts = 0;
      const previous = registerSafeFetch((async () => {
        attempts += 1;
        return bodyFailsMidStream();
      }) as unknown as SafeFetchFn);
      try {
        const job = new SecFetchJob({
          input: {
            url: "https://www.sec.gov/Archives/edgar/big.tar.gz",
            response_type: "arraybuffer",
          } satisfies FetchUrlTaskInput,
        });
        const error = await job.execute(job.input, noopContext).catch((e: unknown) => e);

        expect(attempts).toBe(1);
        expectRetryable(error);
      } finally {
        registerSafeFetch(previous);
      }
    }, 20_000);
  });
});

// EDGAR answers a rate-limit block with a 403 carrying this interstitial as
// often as with a 429. Verbatim wording from the page operators actually see.
const EDGAR_RATE_LIMIT_PAGE =
  "<html><h1>Your Request Originates from an Undeclared Automated Tool</h1>" +
  "<p>Your request rate has exceeded the SEC's maximum allowable requests per second. " +
  "Your access to SEC.gov will be limited for 10 minutes.</p></html>";

// The OTHER 403 EDGAR serves: a User-Agent misconfiguration. No cooldown fixes
// it and every request carries it, so it must keep failing fast.
const EDGAR_UNDECLARED_TOOL_PAGE =
  "<html><h1>Your Request Originates from an Undeclared Automated Tool</h1>" +
  "<p>Please declare your traffic by updating your user agent to include company " +
  "specific information.</p></html>";

describe("EDGAR rate-limit block (403 interstitial)", () => {
  afterEach(() => {
    setSecFetchLimiter(undefined as unknown as RateLimiter);
    // The escalation ladder is module state shared across callers, so a test
    // that left a cooldown in force would coalesce the next test's block into
    // it and see no cluster write at all.
    resetSecFetchThrottleForTesting();
    resetEdgarBlockTranslationForTesting();
  });

  it("tells the rate-limit page apart from the User-Agent page", () => {
    // They share a headline; only one says the RATE was exceeded.
    expect(isEdgarRateLimitBody(EDGAR_RATE_LIMIT_PAGE)).toBe(true);
    expect(isEdgarRateLimitBody(EDGAR_UNDECLARED_TOOL_PAGE)).toBe(false);
  });

  it("pauses the cluster and throws RetryableJobError instead of re-issuing", async () => {
    const writes: Date[] = [];
    setSecFetchLimiter({
      setNextAvailableTime: async (d: Date) => {
        writes.push(d);
      },
    } as unknown as RateLimiter);

    let attempts = 0;
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      return new Response(EDGAR_RATE_LIMIT_PAGE, {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as SafeFetchFn);
    installEdgarBlockTranslation();

    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/x.json",
          response_type: "json",
        } satisfies FetchUrlTaskInput,
      });
      const error = await job.execute(job.input, noopContext).catch((e: unknown) => e);

      // Untranslated this is a 403 — a permanent client error — so the job threw
      // without signalling the cluster. It must now both pause the cluster and
      // stay retryable, with the first-rung wait on retryDate (the queue sleeps
      // it; execute does not).
      expect(attempts).toBe(1);
      expect(writes).toHaveLength(1);
      expect(writes[0].getTime() - Date.now()).toBeGreaterThan(4_000);
      expectRetryWaitMs(expectRetryable(error), 5_000);
    } finally {
      registerSafeFetch(previous);
    }
  });

  it("puts the first-rung cooldown on retryDate for a bare 429, and does not re-issue", async () => {
    // Modelled on a captured EDGAR 429: no Retry-After, a text/html
    // interstitial, and an empty reason phrase (HTTP/2 carries none). The
    // missing header is the point — nothing but the applied cooldown (the
    // ladder's first rung) sizes retryDate. execute() must not sleep or
    // re-issue: the next HTTP is a new queue claim through the limiters.
    const writes: Date[] = [];
    setSecFetchLimiter({
      setNextAvailableTime: async (d: Date) => {
        writes.push(d);
      },
    } as unknown as RateLimiter);

    let attempts = 0;
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      return new Response(EDGAR_RATE_LIMIT_PAGE, {
        status: 429,
        statusText: "",
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as SafeFetchFn);

    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/x.json",
          response_type: "json",
        } satisfies FetchUrlTaskInput,
      });
      const error = await job.execute(job.input, noopContext).catch((e: unknown) => e);

      expect(attempts).toBe(1);
      expect(writes).toHaveLength(1);
      expectRetryWaitMs(expectRetryable(error), 5_000);
    } finally {
      registerSafeFetch(previous);
    }
  });

  it("does not re-issue HTTP from execute when a fleet of jobs hit 5xx together", async () => {
    // execute() used to retry in-process, downstream of every limiter, so a
    // shared 5xx re-issued the whole in-flight set in one tick. Each execute
    // now makes one HTTP call and throws; spacing is the worker's job.
    const FLEET = SecFetchMaxConcurrent;
    const attemptsByUrl = new Map<string, number>();
    const previous = registerSafeFetch((async (url: string) => {
      attemptsByUrl.set(url, (attemptsByUrl.get(url) ?? 0) + 1);
      return new Response("upstream blip", { status: 503 });
    }) as unknown as SafeFetchFn);

    try {
      const results = await Promise.all(
        Array.from({ length: FLEET }, (_, i) => {
          const job = new SecFetchJob({
            input: {
              url: `https://www.sec.gov/Archives/edgar/retry-${i}.json`,
              response_type: "json",
            } satisfies FetchUrlTaskInput,
          });
          return job.execute(job.input, noopContext).catch((e: unknown) => e);
        })
      );
      expect(attemptsByUrl.size).toBe(FLEET);
      expect([...attemptsByUrl.values()].every((n) => n === 1)).toBe(true);
      for (const error of results) expectRetryable(error);
    } finally {
      registerSafeFetch(previous);
    }
  });

  it("does not pause the cluster for a User-Agent 403", async () => {
    const writes: Date[] = [];
    setSecFetchLimiter({
      setNextAvailableTime: async (d: Date) => {
        writes.push(d);
      },
    } as unknown as RateLimiter);

    let attempts = 0;
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      return new Response(EDGAR_UNDECLARED_TOOL_PAGE, {
        status: 403,
        headers: { "Content-Type": "text/html" },
      });
    }) as unknown as SafeFetchFn);
    installEdgarBlockTranslation();
    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/x.json",
          response_type: "json",
        } satisfies FetchUrlTaskInput,
      });
      await expect(
        job.execute(job.input, {
          signal: new AbortController().signal,
          updateProgress: async () => {},
        })
      ).rejects.toThrow();
      expect(attempts).toBe(1);
      expect(writes).toHaveLength(0);
    } finally {
      registerSafeFetch(previous);
    }
  });
});
