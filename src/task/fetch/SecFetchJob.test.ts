/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import "workglow";
import type { FetchUrlTaskInput, SafeFetchFn } from "workglow";
import { registerSafeFetch } from "workglow";

import { SecUserAgent } from "../../config/Constants";
import { SecFetchJob } from "./SecFetchJob";

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
        await vi.advanceTimersByTimeAsync(570_000);
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
