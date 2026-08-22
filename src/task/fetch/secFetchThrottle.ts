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
 * Escalating cooldowns applied on an EDGAR block, in order.
 *
 * **The first trip is not a ban.** EDGAR throttles the offending requests when
 * a burst clears 10 req/s; it escalates to the ~10-minute IP block only if the
 * caller keeps pushing. So a flat ten minutes on the first 429 stops the CLI
 * dead for a condition that a few seconds of quiet clears — and the overshoot
 * is often not even all ours, since the budget is per IP and an ordinary
 * browser tab on the same address spends from it too.
 *
 * The ladder therefore probes: back off briefly, and only conclude we are
 * genuinely banned once a retry after that pause is blocked again. Three rungs
 * reach the full penalty after ~65s of probing, which is the trade — each probe
 * costs a round of requests, and requests sent during a real ban extend it, so
 * more rungs would be gentler on a false alarm and worse on a true one.
 */
const COOLDOWN_LADDER_MS: readonly number[] = [5_000, 60_000, 600_000];

/**
 * Quiet time after a cooldown ends before the ladder resets to its first rung.
 *
 * Anchored on the END of the last cooldown, not the block that caused it, so
 * waiting out a full ban and then running clean does not count the wait itself
 * as part of the quiet period.
 */
const ESCALATION_DECAY_MS = 600_000;

const MAX_COOLDOWN_MS = 600_000;

/** Ladder position and the instant the current cooldown expires. */
let rung = 0;
let cooldownUntil = 0;

/** @internal Test seam — the ladder is module state shared across callers. */
export function resetSecFetchThrottleForTesting(): void {
  rung = 0;
  cooldownUntil = 0;
}

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
 * server-provided Retry-After when present; otherwise walks
 * {@link COOLDOWN_LADDER_MS}, so a first overshoot costs seconds rather than
 * the full penalty. Returns the applied cooldown (ms) so the caller can sleep
 * its own in-flight retry for the same duration.
 */
export async function signalSecFetchThrottle(retryAfterMs?: number): Promise<number> {
  const now = Date.now();

  // Coalesce first. Every in-flight job sees the SAME block and calls in here,
  // so escalating per caller would jump straight to the top rung on the first
  // trip — up to `SEC_FETCH_MAX_CONCURRENT` rungs at once. A block arriving
  // while our cooldown is still in force IS that same trip: hand back the
  // remaining time and leave the ladder alone. Only a block that survives a
  // completed cooldown is new evidence, which is exactly the probe result the
  // ladder wants to escalate on.
  if (now < cooldownUntil) return cooldownUntil - now;

  if (cooldownUntil !== 0 && now - cooldownUntil > ESCALATION_DECAY_MS) rung = 0;

  // Honor a server-provided Retry-After exactly (0 is valid — "retry now" — and
  // must NOT be floored); fall back to the ladder only when EDGAR gives no
  // guidance, which our observed blocks never do. Cap at MAX so a bogus header
  // can't wedge the whole cluster.
  const cooldown = Math.min(
    MAX_COOLDOWN_MS,
    retryAfterMs !== undefined
      ? Math.max(0, retryAfterMs)
      : COOLDOWN_LADDER_MS[Math.min(rung, COOLDOWN_LADDER_MS.length - 1)]
  );
  rung += 1;
  cooldownUntil = now + cooldown;

  if (sharedLimiter && cooldown > 0) {
    try {
      await sharedLimiter.setNextAvailableTime(new Date(now + cooldown));
    } catch {
      // Best-effort: a cooldown-write failure must not mask the fetch error
      // that triggered it. The per-job sleep below still applies locally.
    }
  }
  return cooldown;
}
