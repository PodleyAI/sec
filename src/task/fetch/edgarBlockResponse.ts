/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SafeFetchFn } from "workglow";
import { getSafeFetchImpl, registerSafeFetch } from "workglow";

/**
 * EDGAR's rate-limit interstitial, recognised by its BODY.
 *
 * Status alone cannot identify it, and neither can it be told apart from the
 * OTHER page EDGAR serves under 403 — the "Undeclared Automated Tool"
 * User-Agent rejection, which no cooldown fixes and which must keep failing
 * fast. Both pages share a headline; only the rate-limit one says the request
 * RATE was exceeded and names the ten-minute penalty.
 */
const EDGAR_RATE_LIMIT_BODY_PATTERN =
  /request rate threshold exceeded|your request rate has exceeded|exceeded the sec'?s?\s+(?:maximum allowable|threshold)/i;

/** Only a page is worth scanning; a real 403 body is small. */
const MAX_BLOCK_PAGE_BYTES = 64 * 1024;

export function isEdgarRateLimitBody(body: string): boolean {
  return EDGAR_RATE_LIMIT_BODY_PATTERN.test(body);
}

function isSecHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "sec.gov" || host.endsWith(".sec.gov");
  } catch {
    return false;
  }
}

/**
 * Re-label EDGAR's rate-limit block as the `429` it describes.
 *
 * EDGAR answers a rate-limit block with **403 and an HTML interstitial** at
 * least as often as with a 429. Every layer above reads the status: `403` maps
 * to a permanent client error, so the block arrived as a terminal failure that
 * was never retried and never signalled the cluster cooldown — leaving the
 * sweep firing at full rate for the whole penalty window. SEC's own guidance is
 * that requests made during the time-out EXTEND it, so that path did not merely
 * fail the blocked requests: it renewed the block, which is what made it recur
 * rather than pass.
 *
 * Translating at the transport seam rather than in the retry loop is what keeps
 * it a single fact. The status is the only thing the fetch layer carries
 * forward — it builds the error message from the status line and reads a
 * `{message}` out of a JSON body, so an origin that explains itself in HTML has
 * its reason discarded before any caller sees it. Every consumer already
 * understands 429 (`RetryableJobError`, the `Retry-After` parse, the cluster
 * cooldown, the per-reason failure tallies), so nothing downstream needs a
 * second notion of "blocked".
 *
 * Narrow on purpose: sec.gov only, `403` only, and only when the body says so.
 * A body is read (and re-attached, so the error message keeps it) only for a
 * 403 — a status whose body is a page, never a filing.
 */
export async function translateEdgarBlockResponse(
  url: string,
  response: Response
): Promise<Response> {
  if (response.status !== 403 || !isSecHost(url)) return response;

  const declared = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BLOCK_PAGE_BYTES) return response;

  let body: string;
  try {
    body = await response.text();
  } catch {
    // The body is gone, so the page cannot be identified. A 403 is the
    // conservative answer: it fails fast rather than parking the cluster for
    // ten minutes on a block we have no evidence of.
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("Content-Length"); // a re-encoded body may differ in byte length
  if (!isEdgarRateLimitBody(body)) {
    return new Response(body, { status: 403, statusText: response.statusText, headers });
  }

  // Deliberately NO synthesized Retry-After. EDGAR's ten-minute figure
  // describes the BAN it escalates to, not the first overshoot — stating it
  // here would hand every first trip a ten-minute wait and bypass the
  // escalation ladder that decides how long a block is actually worth waiting.
  return new Response(body, { status: 429, statusText: "Too Many Requests", headers });
}

let installed = false;

/**
 * Wrap the registered SafeFetch so every EDGAR fetch — queued, inline, or from
 * a bulk download — sees the translation. Idempotent, and composes with
 * whatever implementation is already registered (the Node/Bun entrypoints
 * install their own at module load).
 *
 * It composes only with what came BEFORE it: `registerSafeFetch` replaces the
 * slot rather than chaining, so anything registered afterwards — a downstream
 * superset's stub, a test's fake — drops this wrapper, and the `installed` latch
 * means a later `getSecJobQueue()` will not put it back. Register your own
 * implementation before the queue is built, or re-install after.
 */
export function installEdgarBlockTranslation(): void {
  if (installed) return;
  installed = true;
  const inner: SafeFetchFn = getSafeFetchImpl();
  registerSafeFetch(async (url, options) =>
    translateEdgarBlockResponse(url, await inner(url, options))
  );
}

/** @internal Test seam — lets a suite re-install over a swapped-in fake. */
export function resetEdgarBlockTranslationForTesting(): void {
  installed = false;
}
