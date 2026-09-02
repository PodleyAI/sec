/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { closeIdlePoolClients } from "./pg";

describe("closeIdlePoolClients", () => {
  it("destroys every idle client so a stats poll does not keep backends", async () => {
    const released: unknown[] = [];
    const clients = [
      { release: (destroy?: unknown) => released.push(destroy) },
      { release: (destroy?: unknown) => released.push(destroy) },
    ];
    let next = 0;
    await closeIdlePoolClients({
      idleCount: 2,
      connect: async () => clients[next++]!,
    });
    expect(released).toEqual([true, true]);
  });

  it("does not open a client when the pool is already empty", async () => {
    let connects = 0;
    await closeIdlePoolClients({
      idleCount: 0,
      connect: async () => {
        connects += 1;
        return { release: () => undefined };
      },
    });
    expect(connects).toBe(0);
  });
});
