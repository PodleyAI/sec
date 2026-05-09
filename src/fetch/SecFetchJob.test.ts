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
});
