/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import "workglow";
import type { FetchUrlTaskInput } from "workglow";

import { SecUserAgent } from "../config/Constants";
import { SecFetchJob } from "./SecFetchJob";

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

  it("sends User-Agent on the wire for loopback requests", async () => {
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
  });

  describe("retry behavior", () => {
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
});
