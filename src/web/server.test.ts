/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../config/TestingDI";
import { startWebServer, type WebServerHandle } from "./server";

describe("web server", () => {
  let handle: WebServerHandle;

  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    // Port 0 asks the OS for a free port, so a developer already running
    // `sec web` does not make the suite fail.
    handle = await startWebServer({ port: 0, host: "127.0.0.1" });
  });

  afterEach(async () => {
    await handle.close();
  });

  it("serves the overview", async () => {
    const res = await fetch(`${handle.url}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("SPAC pipeline inspector");
  });

  it("404s an unknown path with a readable page", async () => {
    const res = await fetch(`${handle.url}/nope`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("No such page");
  });

  it("accepts a form post and redirects to the run it queued", async () => {
    const res = await fetch(`${handle.url}/api/candidates/rebuild`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "full=1",
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/^\/runs\//);
    expect(handle.registry.list()[0]!.label).toContain("full rescan");
  });

  it("opens an event stream and pushes a run's events to it", async () => {
    const res = await fetch(`${handle.url}/events`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    // The first read is the connect comment, which proves the stream is open
    // before the run that must be observed is enqueued.
    await reader.read();

    handle.registry.enqueue({
      kind: "candidates",
      label: "streamed",
      body: async () => {},
    });

    let seen = "";
    for (let i = 0; i < 20 && !seen.includes("streamed"); i++) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += new TextDecoder().decode(chunk.value);
    }
    expect(seen).toContain("streamed");
    await reader.cancel();
  });

  it("refuses an oversized request body instead of buffering it", async () => {
    const res = await fetch(`${handle.url}/api/process`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "cik=1&junk=" + "x".repeat(300_000),
    });
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("too large");
  });
});
