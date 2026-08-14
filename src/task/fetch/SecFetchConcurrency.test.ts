/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Set BEFORE the dynamic imports below: both constants are resolved at module
// load, and vitest gives each test file its own module registry (`isolate`,
// fork pool), so this is the only window in which the cap can be lowered to a
// value a short test can actually saturate.
process.env.SEC_FETCH_MAX_CONCURRENT = "2";

const { SecFetchMaxConcurrent } = await import("../../config/Constants");
const { getSecJobQueue } = await import("./SecJobQueue");

/** Requests the server holds open at once, and the high-water mark. */
let inFlight = 0;
let peakInFlight = 0;

/**
 * The fetch queue meters STARTS per second, never completions: the worker
 * dispatches each claimed job in the background and loops immediately, and the
 * rate limiter's window is pruned by age. In-flight work is therefore
 * `rate x latency`, so a slow EDGAR admits requests without bound — each
 * holding file descriptors — until the process's table runs dry. The
 * concurrency limiter is what puts a ceiling on the peak.
 */
describe("SEC fetch queue concurrency", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      // Held open long enough that the queue's 8 starts/second would overlap
      // several requests — the whole point is to make the pile-up reachable.
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        inFlight -= 1;
      }, 400);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/doc.txt`;
  });

  afterAll(async () => {
    const { server: queueServer } = await getSecJobQueue();
    await queueServer.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("never runs more fetches at once than SecFetchMaxConcurrent", async () => {
    const { server: queueServer, client } = await getSecJobQueue();
    await queueServer.start();

    // More jobs than the cap by enough that the rate limiter alone (8/s
    // against a 400ms handler) would otherwise stack ~8 of them concurrently.
    const handles = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        client.send({ url: `${url}?n=${i}`, method: "GET", response_type: "text" })
      )
    );
    const outputs = await Promise.all(handles.map((h) => client.waitFor(h.id)));

    expect(outputs).toHaveLength(10);
    for (const output of outputs) expect(output.text).toBe("ok");

    // Upper bound: the defect being fixed. The slot is held until the job
    // reaches a terminal state, so a slow response cannot admit another fetch.
    expect(peakInFlight).toBeLessThanOrEqual(SecFetchMaxConcurrent);
    // Lower bound: keeps the assertion honest. A queue that had silently
    // serialized (peak 1) would satisfy the ceiling while proving nothing
    // about the limiter, so require that fetches did overlap.
    expect(peakInFlight).toBeGreaterThan(1);
  });
});
