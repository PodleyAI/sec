/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import "workglow";
import type { FetchUrlTaskInput, SafeFetchFn } from "workglow";
import { registerSafeFetch, RetryableJobError } from "workglow";
import { SecFetchJob } from "./SecFetchJob";

// The retry/timeout knobs are read once at module load, so they are set before
// SecFetchJob is imported — which is why these tests live in their own file:
// the rest of the suite must keep the production defaults.
vi.hoisted(() => {
  process.env.SEC_FETCH_TIMEOUT_MS = "80";
});

/**
 * A 200 that delivers a byte and then goes silent forever — a stalled body.
 * The attempt can only be ended by the timeout, and only after bytes have
 * already gone out.
 *
 * Deliberately NOT a body that trickles steadily slower than the timeout: the
 * timer measures time WITHOUT PROGRESS, so a steady trickle is a healthy
 * download and never times out (that is the property a multi-GB archive
 * depends on). Going silent after delivering is the real stall.
 */
function stallsAfterDelivering(): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent > 0) {
        // A gap far longer than the window: the connection is up, the bytes
        // have stopped. (A pull that never settles at all would hang the
        // reader rather than let it observe the abort.)
        await new Promise((resolve) => setTimeout(resolve, 5_000));
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

/**
 * A healthy download that simply takes longer than one timeout window,
 * delivering steadily throughout — the shape of every bulk archive and Feed
 * tarball, scaled down.
 */
function steadyBody(chunks: number, gapMs: number): Response {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, gapMs));
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
  it("does not re-issue a stalled attempt once bytes reached a receiver", async () => {
    let attempts = 0;
    const delivered: number[] = [];
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      return stallsAfterDelivering();
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

  // The complement: a timeout before any byte reached the receiver stays
  // retryable. execute() does not re-issue — the worker reschedules through
  // the limiters. The receiver is attached here too; what lifts the ban is
  // that no byte reached it, not the absence of a subscription.
  //
  // This also pins the half of the timer the stall framing does NOT change: no
  // progress means nothing rearms, so a fetch that stalls before its first byte
  // still gets exactly the fixed window it always had.
  it("throws RetryableJobError when a timeout fires before any byte reached the receiver", async () => {
    let attempts = 0;
    const delivered: number[] = [];
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      await sleep(150);
      return wholeBody();
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
      expect(error).toBeInstanceOf(RetryableJobError);
      expect((error as RetryableJobError).retryable).toBe(true);
      expect(delivered).toEqual([]);
    } finally {
      registerSafeFetch(previous);
    }
  }, 20_000);

  // The regression the stall framing exists for. As a wall-clock cap this timer
  // covered the WHOLE body, so a healthy download simply longer than the window
  // aborted mid-stream — and because bytes had reached a receiver, the ban above
  // rethrew rather than retrying, making it unrecoverable. Routing the Feed
  // tarball and the bulk archives through this job put both under that cap:
  // neither could ever finish.
  it("lets a steadily-progressing download outlive the window", async () => {
    let attempts = 0;
    const delivered: number[] = [];
    const previous = registerSafeFetch((async () => {
      attempts += 1;
      // 10 chunks at 40ms = ~400ms of healthy transfer, against an 80ms window.
      return steadyBody(10, 40);
    }) as unknown as SafeFetchFn);
    try {
      const job = new SecFetchJob({
        input: {
          url: "https://www.sec.gov/Archives/edgar/Feed/2021/QTR1/20210305.nc.tar.gz",
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

      expect(attempts).toBe(1);
      expect((out as { metadata?: { status?: number } }).metadata?.status).toBe(200);
      // Every chunk, not the three that fit inside one window.
      expect(delivered).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    } finally {
      registerSafeFetch(previous);
    }
  }, 20_000);
});
