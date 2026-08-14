/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import "workglow";

import { getSecJobQueue } from "./SecJobQueue";

/**
 * `InMemoryQueueStorage` has no eviction of its own — its `jobQueue` array only
 * ever grows — and a completed row on THIS queue holds `output`, which for the
 * accession-doc fetches is an entire filing document (routinely multi-MB for an
 * 8-K full submission). A sweep like `sec spac download 8k` runs one fetch per
 * filing, so without a retention policy the heap grows by the whole downloaded
 * corpus until the process dies. The queue's configuration is what bounds it.
 */
describe("SEC fetch queue retention", () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      // Big enough that retaining one per filing is visibly the problem.
      res.end("x".repeat(64 * 1024));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/doc.txt`;
  });

  afterAll(async () => {
    const { server: queueServer } = await getSecJobQueue();
    await queueServer.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does not retain completed job rows (or their document payloads)", async () => {
    const { server: queueServer, client, storage } = await getSecJobQueue();
    await queueServer.start();

    for (let i = 0; i < 3; i++) {
      // A distinct query per iteration: identical inputs share a fingerprint,
      // which would let dedup hide a retention problem behind one row.
      const handle = await client.send({
        url: `${url}?n=${i}`,
        method: "GET",
        response_type: "text",
      });
      const output = await client.waitFor(handle.id);
      expect(output.text).toHaveLength(64 * 1024);
    }

    // Deleted on the terminal event, after the output reached the waiting
    // client — so the array is flat rather than one row per document fetched.
    // Awaited rather than asserted outright: the client's promise resolves from
    // the forwarded output, and the server's delete is a fire-and-forget
    // follow-up, so the last row is still in the array for a tick or two.
    await vi.waitFor(() => expect(storage.jobQueue).toHaveLength(0), { timeout: 5_000 });
  });
});
