/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { handleWebRequest, type WebRequest } from "./handler";
import { RunRegistry } from "./runs";

/** Refuse a request body larger than this. Every form here is a handful of fields. */
const MAX_BODY_BYTES = 256 * 1024;

/** Heartbeat interval for an idle event stream, so a proxy does not reap it. */
const SSE_KEEPALIVE_MS = 25_000;

export interface WebServerHandle {
  readonly server: Server;
  readonly registry: RunRegistry;
  readonly url: string;
  readonly close: () => Promise<void>;
}

/**
 * `node:http` rather than `Bun.serve`, so one implementation serves both
 * runtimes: the CLI runs under Bun, and the tests run under Node.
 */
export async function startWebServer(args: {
  readonly port: number;
  readonly host: string;
}): Promise<WebServerHandle> {
  const registry = new RunRegistry();
  const server = createServer((req, res) => {
    void serve(req, res, registry);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port, args.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : args.port;
  // A bare IPv6/IPv4 wildcard is not something you can paste into a browser.
  const displayHost = args.host === "0.0.0.0" || args.host === "::" ? "localhost" : args.host;
  return {
    server,
    registry,
    url: `http://${displayHost}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  registry: RunRegistry
): Promise<void> {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const form =
      req.method === "POST" ? new URLSearchParams(await readBody(req)) : new URLSearchParams();
    const request: WebRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      form,
    };
    const result = await handleWebRequest(request, registry);
    if (result.kind === "sse") {
      streamEvents(res, registry, result.cik, result.runId);
      return;
    }
    res.writeHead(result.status, result.headers);
    res.end(result.body);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // A page that throws must say so in the browser rather than hanging the
    // socket — the whole point of this server is looking at things that are
    // going wrong.
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`500 ${message}`);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Forward run events to one browser as server-sent events.
 *
 * A replay of a de-SPAC'd company's timeline runs for the better part of an
 * hour, so the page cannot hold a request open for it and polling would either
 * lag badly or rebuild every table on every tick. The stream carries the run
 * record plus the one event that changed, which is enough for the process page
 * to repaint a single row.
 */
function streamEvents(
  res: ServerResponse,
  registry: RunRegistry,
  cik: number | undefined,
  runId: string | undefined
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    // Proxies that buffer would defeat the entire mechanism.
    "x-accel-buffering": "no",
  });
  res.write(": connected\n\n");

  const unsubscribe = registry.subscribe((run, event) => {
    if (runId !== undefined && run.id !== runId) return;
    if (cik !== undefined && run.cik !== cik) return;
    // The full transcript is on the run's own page; the stream carries only the
    // record's summary plus the single event, so a long replay does not re-send
    // its whole log on every line.
    const payload = {
      run: { ...run, events: [] },
      event,
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  });

  const keepalive = setInterval(() => res.write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
  const stop = (): void => {
    clearInterval(keepalive);
    unsubscribe();
  };
  res.on("close", stop);
  res.on("error", stop);
}
