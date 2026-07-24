/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RateLimiter } from "workglow";
import { afterEach, describe, expect, it } from "vitest";
import { setSecFetchLimiter, signalSecFetchThrottle } from "./secFetchThrottle";

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
    // Reset the module singleton so tests don't leak the fake into each other.
    setSecFetchLimiter(undefined as unknown as RateLimiter);
  });

  it("applies the default cooldown when no Retry-After is supplied", async () => {
    const { limiter, writes } = makeFakeLimiter();
    setSecFetchLimiter(limiter);

    const before = Date.now();
    const cooldown = await signalSecFetchThrottle();

    expect(cooldown).toBe(60_000);
    expect(writes).toHaveLength(1);
    const ahead = writes[0].getTime() - before;
    expect(ahead).toBeGreaterThanOrEqual(59_000);
    expect(ahead).toBeLessThanOrEqual(61_000);
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
