/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import "workglow";
import type { FetchUrlTaskInput, RateLimiter, SafeFetchFn } from "workglow";
import { registerSafeFetch } from "workglow";

import { SecFetchMaxPerSec, SecUserAgent } from "../../config/Constants";
import { SecFetchJob } from "./SecFetchJob";
import {
  installEdgarBlockTranslation,
  isEdgarRateLimitBody,
  resetEdgarBlockTranslationForTesting,
} from "./edgarBlockResponse";
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

function wholeBody(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "content-type": "application/octet-stream", "content-length": "3" },
  });
}

// Retries are spread uniformly over two drain windows:
// ceil(SEC_FETCH_MAX_CONCURRENT / SEC_FETCH_MAX_PER_SEC) * 2s.
const DRAIN_WINDOW_MS = 4_000;

describe("SecFetchJob", () => {
  it("merges SEC User-Agent onto job input", () => {
    const job = new SecFetchJob({
      input: {
        url: "https://data.sec.gov/submissions/CIK0000320193.json",
      } satisfies FetchUrlTaskInput,
    });
    expect(job.input.headers?.["User-Agent"]).toBe(SecUserAgent);
  });

  it("lets caller headers extend defaults without replacing unrelated keys", () => {
    const job = new SecFetchJob({
      input: {
        url: "https://example.com/",
        headers: { Accept: "application/json" },
      } satisfies FetchUrlTaskInput,
    });
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
    it("retries on 429 honoring Retry-After and eventually succeeds", async () => {
      let attempts = 0;
      const server = Bun.serve({
        port: 0,
        fetch() {
          attempts++;
          if (attempts < 3) {
            return new Response("rate limited", {
              status: 429,
              headers: { "Retry-After": "0" },
            });
          }
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      });
      try {
        const url = `http://127.0.0.1:${server.port}/x.json`;
        const job = new SecFetchJob({
          input: { url, response_type: "json" } satisfies FetchUrlTaskInput,
        });
        const out = await job.execute(job.input, {
          signal: new AbortController().signal,
          updateProgress: async () => {},
        });
        expect(attempts).toBe(3);
        expect((out as { json?: { ok?: boolean } }).json?.ok).toBe(true);
      } finally {
        server.stop();
      }
    }, 15_000);

    it("retries on 5xx and ultimately surfaces the error", async () => {
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
        await expect(
          job.execute(job.input, {
            signal: new AbortController().signal,
            updateProgress: async () => {},
          })
        ).rejects.toBeDefined();
        // Retried at least once before giving up.
        expect(attempts).toBeGreaterThan(1);
      } finally {
        server.stop();
      }
    }, 30_000);

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

  // A hostile or buggy Retry-After: 86400 used to park this job on a setTimeout
  // for a day. The cluster pause is already capped; this is the job's OWN sleep.
  describe("Retry-After cap", () => {
    afterEach(() => {
      vi.useRealTimers();
      // This test signals a 600s cluster cooldown, and the ladder is module
      // state keyed on wall-clock time — which `useRealTimers` rewinds back
      // inside that window. Without the reset the NEXT test's block coalesces
      // into this one's cooldown and writes nothing to the limiter, so the
      // suite only passes on the accident that the following test happens to
      // be a pure unit test whose own afterEach clears it.
      resetSecFetchThrottleForTesting();
    });

    it("caps a huge Retry-After so a sweep cannot park for a day", async () => {
      vi.useFakeTimers();
      let attempts = 0;
      const previous = registerSafeFetch((async () => {
        attempts += 1;
        if (attempts === 1) {
          return new Response("rate limited", {
            status: 429,
            headers: { "Retry-After": "86400" },
          });
        }
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as SafeFetchFn);
      const ac = new AbortController();
      let promise: Promise<unknown> | undefined;
      try {
        const job = new SecFetchJob({
          input: {
            url: "https://www.sec.gov/Archives/edgar/x.json",
            response_type: "json",
          } satisfies FetchUrlTaskInput,
        });
        promise = job.execute(job.input, {
          signal: ac.signal,
          updateProgress: async () => {},
        });
        // EDGAR's own pushback is ~10 minutes; a 30s ceiling would retry
        // inside that window and keep the block alive. A 86400s header
        // must still not park a sweep for a day.
        await vi.advanceTimersByTimeAsync(30_000);
        expect(attempts).toBe(1);
        // The cap bounds the WAIT; the anti-herd spread is added on top of it,
        // so a re-issue lands within one drain window after the ceiling.
        await vi.advanceTimersByTimeAsync(570_000);
        await vi.advanceTimersByTimeAsync(DRAIN_WINDOW_MS);
        expect(attempts).toBe(2);
        const out = await promise;
        expect((out as { json?: { ok?: boolean } }).json?.ok).toBe(true);
      } finally {
        ac.abort();
        await promise?.catch(() => {});
        registerSafeFetch(previous);
      }
    });
  });

  // The in-job loop is the second half of workglow's post-delivery retry ban.
  // Workglow marks a mid-body failure non-retryable once bytes have reached a
  // stream receiver, because the consumer's subscription outlives the attempt
  // and a re-issue from byte 0 would concatenate onto the partial body. This
  // loop is a SEPARATE retry path that never sees the queue's policy, so
  // nothing but `isRetriableError`'s `retryable === false` short-circuit stops
  // it re-issuing — an assumption with no test on either side of the boundary.
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
    // failure stays retryable and this loop absorbs it — the behavior a large
    // EDGAR download depends on.
    it("still re-issues a mid-body failure when nothing received the bytes", async () => {
      let attempts = 0;
      const previous = registerSafeFetch((async () => {
        attempts += 1;
        return attempts === 1 ? bodyFailsMidStream() : wholeBody();
      }) as unknown as SafeFetchFn);
      try {
        const job = new SecFetchJob({
          input: {
            url: "https://www.sec.gov/Archives/edgar/big.tar.gz",
            response_type: "arraybuffer",
          } satisfies FetchUrlTaskInput,
        });
        const out = await job.execute(job.input, {
          signal: new AbortController().signal,
          updateProgress: async () => {},
        });

        expect(attempts).toBe(2);
        expect((out as { metadata?: { status?: number } }).metadata?.status).toBe(200);
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
    vi.useRealTimers();
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

  it("pauses the cluster and waits the block out, instead of failing at once", async () => {
    vi.useFakeTimers();
    const writes: Date[] = [];
    setSecFetchLimiter({
      setNextAvailableTime: async (d: Date) => {
        writes.push(d);
      },
    } as unknown as RateLimiter);

    let attempts = 0;
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(EDGAR_RATE_LIMIT_PAGE, {
          status: 403,
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as SafeFetchFn);
    installEdgarBlockTranslation();

    const ac = new AbortController();
    let promise: Promise<unknown> | undefined;
    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/x.json",
          response_type: "json",
        } satisfies FetchUrlTaskInput,
      });
      promise = job.execute(job.input, { signal: ac.signal, updateProgress: async () => {} });

      // Untranslated this is a 403 — a permanent client error — so the job threw
      // here without ever signalling the cluster, leaving the sweep firing at
      // full rate and renewing the block. It must now both pause the cluster
      // and stay retryable.
      await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveLength(1);
      expect(writes[0].getTime() - Date.now()).toBeGreaterThan(4_000);

      // First trip: seconds, not the full ban.
      await vi.advanceTimersByTimeAsync(5_000 + DRAIN_WINDOW_MS + 1);
      expect(attempts).toBe(2);
      expect((await promise) as { json?: { ok?: boolean } }).toMatchObject({
        json: { ok: true },
      });
    } finally {
      ac.abort();
      await promise?.catch(() => {});
      registerSafeFetch(previous);
    }
  });

  it("waits out the cluster cooldown on a bare 429, not the ordinary backoff", async () => {
    // Modelled on a captured EDGAR 429: no Retry-After, a text/html
    // interstitial, and an empty reason phrase (HTTP/2 carries none). The
    // missing header is the point — nothing but the applied cooldown (the
    // ladder's first rung) sizes this wait. The cluster sentinel gates DISPATCH and this job is already
    // dispatched, its retry loop never re-consulting the limiter, so an ~30s
    // backoff put every in-flight request back on the wire deep inside the
    // ten-minute penalty window and extended it for everyone — including, as
    // observed, an ordinary browser sharing the IP.
    vi.useFakeTimers();
    const writes: Date[] = [];
    setSecFetchLimiter({
      setNextAvailableTime: async (d: Date) => {
        writes.push(d);
      },
    } as unknown as RateLimiter);

    let attempts = 0;
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(EDGAR_RATE_LIMIT_PAGE, {
          status: 429,
          statusText: "",
          headers: { "Content-Type": "text/html" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as SafeFetchFn);

    const ac = new AbortController();
    let promise: Promise<unknown> | undefined;
    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/x.json",
          response_type: "json",
        } satisfies FetchUrlTaskInput,
      });
      promise = job.execute(job.input, { signal: ac.signal, updateProgress: async () => {} });

      await vi.advanceTimersByTimeAsync(1);
      expect(writes).toHaveLength(1);

      // The ordinary first backoff (1s) elapses with no re-issue: the applied
      // cooldown governs, not the backoff.
      await vi.advanceTimersByTimeAsync(1_000 + DRAIN_WINDOW_MS);
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(4_001);
      expect(attempts).toBe(2);
      expect((await promise) as { json?: { ok?: boolean } }).toMatchObject({ json: { ok: true } });
    } finally {
      ac.abort();
      await promise?.catch(() => {});
      registerSafeFetch(previous);
    }
  });

  it("still spreads when the cooldown already sits at the retry ceiling", async () => {
    // The default block case exactly: a 600s cooldown against a 600s cap.
    // Capping the SUM of wait and spread silently ate the spread here — the
    // one place it matters most, since every blocked job applies the same
    // cooldown from the same response and would wake in the same tick.
    vi.useFakeTimers();
    const realRandom = Math.random;
    Math.random = () => 0.5; // a spread of exactly half the window
    setSecFetchLimiter({ setNextAvailableTime: async () => {} } as unknown as RateLimiter);

    let attempts = 0;
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response("slow down", {
          status: 429,
          headers: { "Retry-After": "86400" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as SafeFetchFn);

    const ac = new AbortController();
    let promise: Promise<unknown> | undefined;
    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/x.json",
          response_type: "json",
        } satisfies FetchUrlTaskInput,
      });
      promise = job.execute(job.input, { signal: ac.signal, updateProgress: async () => {} });

      // At the cap itself the spread must not yet have elapsed.
      await vi.advanceTimersByTimeAsync(600_000);
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(DRAIN_WINDOW_MS / 2 + 1);
      expect(attempts).toBe(2);
    } finally {
      Math.random = realRandom;
      ac.abort();
      await promise?.catch(() => {});
      registerSafeFetch(previous);
    }
  });

  it("spreads a shared 5xx failure's retries wider than one tick", async () => {
    // The concurrency limiter bounds SIMULTANEITY, not rate, and a retry
    // re-issues from inside the job where no limiter governs it. Every
    // in-flight job fails on the same upstream event and computes the same
    // backoff, so the recovery arrives as a burst: `backoffDelay(0)` alone
    // spreads the first retry across only 500ms, which for a full set of
    // in-flight fetches is far over EDGAR's 10/s ceiling.
    vi.useFakeTimers();
    const FLEET = 16;
    // A uniform sweep in place of Math.random, so this asserts the spreading
    // FORMULA rather than one draw's luck. Each job consumes exactly one
    // random (the backoff itself is deterministic), so the sweep maps 1:1.
    let draw = 0;
    const realRandom = Math.random;
    Math.random = () => (draw++ % FLEET) / FLEET;
    // Per-URL timestamps, so the measurement is each job's FIRST retry rather
    // than whatever attempts happen to fall inside the window — later attempts
    // back off further and would flatter the result.
    const attemptsByUrl = new Map<string, number[]>();
    const previous = registerSafeFetch((async (url: string) => {
      const seen = attemptsByUrl.get(url) ?? [];
      seen.push(Date.now());
      attemptsByUrl.set(url, seen);
      return new Response("upstream blip", { status: 503 });
    }) as unknown as SafeFetchFn);

    const ac = new AbortController();
    const runs: Array<Promise<unknown>> = [];
    try {
      for (let i = 0; i < FLEET; i++) {
        const job = new SecFetchJob({
          input: {
            url: `https://www.sec.gov/Archives/edgar/retry-${i}.json`,
            response_type: "json",
          } satisfies FetchUrlTaskInput,
        });
        runs.push(job.execute(job.input, { signal: ac.signal, updateProgress: async () => {} }));
      }
      await vi.advanceTimersByTimeAsync(1);
      expect(attemptsByUrl.size).toBe(FLEET);

      // Past the first backoff plus one full drain window.
      await vi.advanceTimersByTimeAsync(1_000 + DRAIN_WINDOW_MS + 1);
      const firstRetries = [...attemptsByUrl.values()].map((ts) => ts[1]);
      expect(firstRetries.every((t) => typeof t === "number")).toBe(true);

      // No 1s slice of those re-issues may exceed the configured rate. Without
      // the spread all 16 land inside 500ms — ~32/s.
      const worstPerSecond = Math.max(
        ...firstRetries.map((t) => firstRetries.filter((u) => u >= t && u < t + 1_000).length)
      );
      expect(worstPerSecond).toBeLessThanOrEqual(SecFetchMaxPerSec);
    } finally {
      Math.random = realRandom;
      ac.abort();
      await Promise.allSettled(runs);
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
