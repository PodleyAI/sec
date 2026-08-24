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
  readExternalPause = undefined;
}

/**
 * Reads the cluster-visible pause sentinel, in epoch ms (0 when unset).
 *
 * Deliberately NOT `RateLimiter.getNextAvailableTime()`, which returns the
 * latest of three things: the rate-limit wall, this sentinel, AND the
 * instance's `localBackoffUntilMs` — a hint libs documents as keeping "this
 * process's worker from re-acquiring without polluting cluster state". Feeding
 * that composite back into {@link RateLimiter.setNextAvailableTime} publishes
 * the process-local hint as a cluster-wide pause, so a 5s first-rung trip taken
 * while local backoff sat at its 60s ceiling would pause every shard for a
 * minute — the over-reaction the ladder exists to avoid.
 */
export type ExternalPauseReader = () => Promise<number>;

let readExternalPause: ExternalPauseReader | undefined;

/** Registered by {@link getSecJobQueue} once the shared limiter is built. */
export function setSecFetchLimiter(limiter: RateLimiter, reader?: ExternalPauseReader): void {
  sharedLimiter = limiter;
  readExternalPause = reader;
}

/**
 * When the fetch cluster may next dispatch, in epoch ms (0 when nothing is
 * pausing it). A reporting read: it takes no rung and arms no window.
 *
 * Reads the same sentinel {@link signalSecFetchThrottle} writes rather than
 * this process's `cooldownUntil`, because the process asking is usually not the
 * one that was blocked — the web console runs each command as a child, so the
 * server's own module state is always empty. That also bounds what it can answer:
 * under Postgres the sentinel is a shared table and the reading is the
 * cluster's, while under SQLite the limiter storage is in-memory and per
 * process, so a caller outside the fetching process learns nothing and should
 * say so rather than report "clear".
 */
export async function readSecFetchPauseUntil(): Promise<number> {
  const external = readExternalPause ? await readExternalPause().catch(() => 0) : 0;
  return Math.max(external, cooldownUntil);
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
 * the full penalty. Returns the applied cooldown (ms) so the caller can put
 * that wait on `RetryableJobError.retryDate` — the worker reschedules through
 * the limiters; this job does not sleep the wait itself.
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
  // A zero cooldown is a server saying "retry now", which is not evidence of a
  // ban and must not climb the ladder — and it would ALSO defeat the coalescing
  // above (`cooldownUntil = now` is already past for the next caller), so a
  // fleet handed `Retry-After: 0` would climb one rung per in-flight job and
  // land on the top rung from a response that asked for no wait at all.
  if (cooldown <= 0) return 0;

  rung += 1;
  cooldownUntil = now + cooldown;

  let applied = cooldown;
  if (sharedLimiter) {
    try {
      // The cluster pause may only ever move FORWARD, so write the LATER of
      // what is already there and what this trip asks for. `setNextAvailableTime`
      // lands on an unconditional `DO UPDATE SET next_available_at = EXCLUDED`,
      // and the ladder is PROCESS state, so a second shard meeting the same
      // block at rung 0 would otherwise replace another shard's 600s pause with
      // its own 5s one and resume the whole cluster nine minutes deep inside a
      // live ban — the exact herd this sentinel exists to prevent. Whichever
      // value wins is adopted as this job's own wait too, since the caller
      // sleeps what we return and re-firing before the cluster may dispatch is
      // what renews the ban.
      //
      // Read-then-write is not atomic across processes, so a simultaneous pair
      // can still race; this turns a systematic clobber into a rare one. The
      // race closes properly with a `GREATEST(...)` in the storage's upsert,
      // which is a `@workglow/postgres` change.
      const currentMs = readExternalPause ? await readExternalPause() : 0;
      const targetMs = Math.min(now + MAX_COOLDOWN_MS, Math.max(now + cooldown, currentMs));
      applied = targetMs - now;
      cooldownUntil = targetMs;
      await sharedLimiter.setNextAvailableTime(new Date(targetMs));
    } catch {
      // Best-effort: a cooldown-write failure must not mask the fetch error
      // that triggered it. The job still throws RetryableJobError with this
      // local cooldown on retryDate.
    }
  }
  return applied;
}
