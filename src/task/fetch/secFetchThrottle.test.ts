/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { RateLimiter } from "workglow";
import {
  resetSecFetchThrottleForTesting,
  setSecFetchLimiter,
  signalSecFetchThrottle,
} from "./secFetchThrottle";
import type { ExternalPauseReader } from "./secFetchThrottle";

// Captures the cluster-cooldown writes without a real limiter/DB.
function makeFakeLimiter(): { limiter: RateLimiter; writes: Date[] } {
  const writes: Date[] = [];
  const limiter = {
    setNextAvailableTime: async (d: Date) => {
      writes.push(d);
    },
  } as unknown as RateLimiter;
  return { limiter, writes };
}

describe("signalSecFetchThrottle", () => {
  afterEach(() => {
    // Reset the module singletons so tests don't leak the fake — or the
    // escalation ladder's position — into each other.
    setSecFetchLimiter(undefined as unknown as RateLimiter);
    resetSecFetchThrottleForTesting();
  });

  it("costs seconds on the first trip, not the full ban", async () => {
    const { limiter, writes } = makeFakeLimiter();
    setSecFetchLimiter(limiter);

    const before = Date.now();
    const cooldown = await signalSecFetchThrottle();

    // A first overshoot is throttled, not banned — and the 10 req/s budget is
    // per IP, so it may not even be all ours. Stopping the CLI for ten minutes
    // over a condition a few seconds of quiet clears is the wrong trade.
    expect(cooldown).toBe(5_000);
    expect(writes).toHaveLength(1);
    const ahead = writes[0].getTime() - before;
    expect(ahead).toBeGreaterThanOrEqual(4_000);
    expect(ahead).toBeLessThanOrEqual(6_000);
  });

  it("escalates only when a retry after a completed cooldown is blocked again", async () => {
    vi.useFakeTimers();
    try {
      const { limiter } = makeFakeLimiter();
      setSecFetchLimiter(limiter);

      expect(await signalSecFetchThrottle()).toBe(5_000);
      // Probe: let the cooldown expire, then get blocked again. That, and only
      // that, is evidence the first backoff was not enough.
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await signalSecFetchThrottle()).toBe(60_000);
      await vi.advanceTimersByTimeAsync(60_001);
      expect(await signalSecFetchThrottle()).toBe(600_000);
      // Top rung holds; it never exceeds EDGAR's stated penalty.
      await vi.advanceTimersByTimeAsync(600_001);
      expect(await signalSecFetchThrottle()).toBe(600_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats a whole fleet blocking at once as ONE trip", async () => {
    vi.useFakeTimers();
    try {
      const { limiter } = makeFakeLimiter();
      setSecFetchLimiter(limiter);

      // Every in-flight job sees the same block and reports it. Escalating per
      // caller would jump straight to the top rung on the very first trip.
      const first = await signalSecFetchThrottle();
      expect(first).toBe(5_000);

      await vi.advanceTimersByTimeAsync(10);
      const stragglers = await Promise.all(
        Array.from({ length: 15 }, () => signalSecFetchThrottle())
      );
      // Each straggler is told the time REMAINING, so it does not restart a
      // fresh full cooldown of its own.
      for (const c of stragglers) {
        expect(c).toBeLessThanOrEqual(5_000);
        expect(c).toBeGreaterThan(4_000);
      }

      // Still rung 1: the next NEW trip after this cooldown is only the second.
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await signalSecFetchThrottle()).toBe(60_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("resets to the first rung after a quiet period", async () => {
    vi.useFakeTimers();
    try {
      const { limiter } = makeFakeLimiter();
      setSecFetchLimiter(limiter);

      expect(await signalSecFetchThrottle()).toBe(5_000);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await signalSecFetchThrottle()).toBe(60_000);

      // Quiet is measured from the END of the cooldown, so waiting out a long
      // block is not itself counted as the clean period that earns a reset.
      await vi.advanceTimersByTimeAsync(60_000 + 600_001);
      expect(await signalSecFetchThrottle()).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never pulls the cluster pause backwards", async () => {
    // The ladder is PROCESS state and the storage write is an unconditional
    // upsert, so a second shard meeting the same block at rung 0 would replace
    // another shard's 600s pause with its own 5s one and resume every shard
    // deep inside a live ban.
    const { limiter, writes } = makeFakeLimiter();
    const farFuture = Date.now() + 500_000;
    const reader: ExternalPauseReader = async () => farFuture;
    setSecFetchLimiter(limiter, reader);

    const cooldown = await signalSecFetchThrottle(); // first rung: 5s
    expect(cooldown).toBeGreaterThan(400_000);
    expect(writes[0].getTime()).toBeGreaterThanOrEqual(farFuture);
  });

  it("does not adopt a process-local backoff as a cluster-wide pause", async () => {
    // `RateLimiter.getNextAvailableTime()` folds in `localBackoffUntilMs` — a
    // hint libs keeps out of cluster state on purpose. Reading that composite
    // and writing it back would publish it, turning a 5s first trip into a
    // minute-long pause for every shard. The reader must see only the sentinel.
    const { limiter, writes } = makeFakeLimiter();
    // The limiter's own composite reports a far-future instant, as it does when
    // `localBackoffUntilMs` is at its 60s ceiling. The SENTINEL is unset.
    (limiter as unknown as { getNextAvailableTime: () => Promise<Date> }).getNextAvailableTime =
      async () => new Date(Date.now() + 60_000);
    setSecFetchLimiter(limiter, async () => 0);

    const before = Date.now();
    // The first rung, not the composite: local backoff must not be published.
    expect(await signalSecFetchThrottle()).toBe(5_000);
    expect(writes[0].getTime() - before).toBeLessThanOrEqual(6_000);
  });

  it("honors a server Retry-After exactly", async () => {
    const { limiter, writes } = makeFakeLimiter();
    setSecFetchLimiter(limiter);

    const cooldown = await signalSecFetchThrottle(5_000);
    expect(cooldown).toBe(5_000);
    expect(writes).toHaveLength(1);
  });

  it("treats Retry-After 0 as 'retry now' and does NOT pause the cluster", async () => {
    const { limiter, writes } = makeFakeLimiter();
    setSecFetchLimiter(limiter);

    const cooldown = await signalSecFetchThrottle(0);
    expect(cooldown).toBe(0);
    // cooldown 0 => no cluster pause written
    expect(writes).toHaveLength(0);
  });

  it("caps a bogus/huge Retry-After so it can't wedge the cluster", async () => {
    const { limiter, writes } = makeFakeLimiter();
    setSecFetchLimiter(limiter);

    const cooldown = await signalSecFetchThrottle(9_999_999_999);
    expect(cooldown).toBe(600_000); // MAX_COOLDOWN_MS
    expect(writes).toHaveLength(1);
  });

  it("is a no-op (no throw) when no limiter is registered", async () => {
    const cooldown = await signalSecFetchThrottle(1_000);
    expect(cooldown).toBe(1_000);
  });
});
