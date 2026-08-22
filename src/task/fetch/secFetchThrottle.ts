/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RateLimiter } from "workglow";

// Kept in its own module (not SecJobQueue) so SecFetchJob can trigger a
// cluster cooldown without importing the queue module, avoiding an import
// cycle (SecJobQueue imports SecFetchJob to construct the server).
let sharedLimiter: RateLimiter | undefined;

/**
 * Cluster cooldown applied on an EDGAR block when no Retry-After is supplied.
 *
 * EDGAR states the penalty: exceeding the rate ceiling limits the IP "for 10
 * minutes", and requests made inside that window EXTEND it. Our observed blocks
 * carry no Retry-After, so this default is the only thing sizing the wait — and
 * at a minute it resumed the whole cluster nine minutes early, into a block
 * still in force, which renewed it. Waiting the stated period costs nothing that
 * was available anyway: every request sent during it would have been refused.
 */
const DEFAULT_COOLDOWN_MS = 600_000;
const MAX_COOLDOWN_MS = 600_000;

/** Registered by {@link getSecJobQueue} once the shared limiter is built. */
export function setSecFetchLimiter(limiter: RateLimiter): void {
  sharedLimiter = limiter;
}

/**
 * On an EDGAR rate-limit block (a 429, or the 403 interstitial — see
 * `isEdgarRateLimitBlock`), pause the ENTIRE fetch cluster — every shard process — for a
 * cooldown by pushing the rate limiter's cluster-visible next-available-time
 * into the future (via the shared `rate_limit_next_available` table). Without
 * this, each of the up-to-(N shards × concurrency) in-flight jobs retries on
 * its own — a thundering herd that keeps EDGAR's IP block alive. Honors a
 * server-provided Retry-After when present; otherwise a fixed default, clamped
 * to a sane range. Best-effort and idempotent: near-simultaneous callers all
 * write ~the same instant (last-writer-wins). Returns the applied cooldown (ms)
 * so the caller can sleep its own in-flight retry for the same duration.
 */
export async function signalSecFetchThrottle(retryAfterMs?: number): Promise<number> {
  // Honor a server-provided Retry-After exactly (0 is valid — "retry now" — and
  // must NOT be floored); fall back to the default only when EDGAR gives no
  // guidance (our observed blocks carry no Retry-After). Cap at MAX so a bogus
  // header can't wedge the whole cluster.
  const cooldown = Math.min(
    MAX_COOLDOWN_MS,
    retryAfterMs !== undefined ? Math.max(0, retryAfterMs) : DEFAULT_COOLDOWN_MS
  );
  if (sharedLimiter && cooldown > 0) {
    try {
      await sharedLimiter.setNextAvailableTime(new Date(Date.now() + cooldown));
    } catch {
      // Best-effort: a cooldown-write failure must not mask the fetch error
      // that triggered it. The per-job sleep below still applies locally.
    }
  }
  return cooldown;
}
