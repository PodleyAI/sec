/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import "workglow";
import type { FetchUrlTaskInput, SafeFetchFn } from "workglow";
import { registerSafeFetch } from "workglow";

// The retry/timeout knobs are read once at module load, so they are set before
// SecFetchJob is imported — which is why these tests live in their own file:
// the rest of the suite must keep the production defaults.
vi.hoisted(() => {
  process.env.SEC_FETCH_TIMEOUT_MS = "80";
  process.env.SEC_FETCH_INITIAL_BACKOFF_MS = "1";
  process.env.SEC_FETCH_MAX_BACKOFF_MS = "1";
});

import { SecFetchJob } from "./SecFetchJob";

/**
 * A 200 whose body trickles a byte at a time, slower than the per-attempt
 * timeout and never ending — so the attempt can only be ended by the timeout,
 * and only after bytes have already gone out.
 */
function tricklingBody(): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, 40));
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A per-attempt timeout aborts the fetch, which surfaces as AbortSignalJobError
// — a shape workglow's body classifier passes through untouched, so the
// BODY_TRUNCATED conversion that bans a post-delivery retry never covers it.
// This loop has to enforce the ban itself: retrying re-issues from byte 0 while
// the consumer's subscription outlives the attempt, concatenating a second body
// onto the first.
describe("SecFetchJob per-attempt timeout", () => {
  it("does not re-issue a timed-out attempt once bytes reached a receiver", async () => {
    let attempts = 0;
    const delivered: number[] = [];
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      return tricklingBody();
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
          emitStreamEvent: async (event) => {
            if (event.type !== "binary-delta") return;
            delivered.push(...(event.binaryDelta as Uint8Array));
          },
        })
        .catch((e: unknown) => e);

      expect(attempts).toBe(1);
      expect(error).toBeInstanceOf(Error);
      // Every attempt's body starts at byte 1, so a second 1 on the same
      // subscription is a second body concatenated onto the first.
      expect(delivered.filter((byte) => byte === 1)).toHaveLength(1);
    } finally {
      registerSafeFetch(previous);
    }
  }, 20_000);

  // The complement, through the same error: a timeout that fires before the
  // body loop reads anything delivers nothing, so there is nothing to
  // concatenate onto and the retry a slow EDGAR endpoint depends on still runs.
  // The receiver is attached here too — what lifts the ban is that no byte
  // reached it, not the absence of a subscription.
  it("still re-issues a timed-out attempt when no bytes reached the receiver", async () => {
    let attempts = 0;
    const delivered: number[] = [];
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      // Past the deadline before a single byte is read on the first attempt.
      if (attempts === 1) await sleep(150);
      return wholeBody();
    }) as unknown as SafeFetchFn);
    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/big.tar.gz",
          response_type: "stream",
        } satisfies FetchUrlTaskInput,
      });
      const out = await job.execute(job.input, {
        signal: new AbortController().signal,
        updateProgress: async () => {},
        emitStreamEvent: async (event) => {
          if (event.type !== "binary-delta") return;
          delivered.push(...(event.binaryDelta as Uint8Array));
        },
      });

      expect(attempts).toBe(2);
      expect((out as { metadata?: { status?: number } }).metadata?.status).toBe(200);
      expect(delivered).toEqual([1, 2, 3]);
    } finally {
      registerSafeFetch(previous);
    }
  }, 20_000);
});
