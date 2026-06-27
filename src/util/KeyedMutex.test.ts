/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { KeyedMutex } from "./KeyedMutex";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe("KeyedMutex", () => {
  it("serialises critical sections sharing a key", async () => {
    const km = new KeyedMutex<string>();
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const section = (label: string) => async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push(`start:${label}`);
      await Promise.resolve();
      await Promise.resolve();
      order.push(`end:${label}`);
      inFlight--;
    };

    await Promise.all([km.lock("k", section("a")), km.lock("k", section("b"))]);

    // Same key never overlaps, and runs FIFO.
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  it("lets different keys run concurrently", async () => {
    const km = new KeyedMutex<string>();
    const a = deferred();
    let bRan = false;

    // 'a' blocks until released; 'b' (different key) must still complete.
    const pa = km.lock("a", async () => {
      await a.promise;
    });
    const pb = km.lock("b", async () => {
      bRan = true;
    });

    await pb;
    expect(bRan).toBe(true); // not blocked behind 'a'
    a.resolve();
    await pa;
  });

  it("evicts a key's mutex once no holders remain", async () => {
    const km = new KeyedMutex<string>();
    await km.lock("k", async () => {});
    expect(km.size).toBe(0);
  });

  it("propagates a critical section's rejection without poisoning later locks", async () => {
    const km = new KeyedMutex<string>();
    await expect(
      km.lock("k", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    // A subsequent lock on the same key still runs.
    const ran = await km.lock("k", async () => 42);
    expect(ran).toBe(42);
    expect(km.size).toBe(0);
  });
});
