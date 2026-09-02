/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { closeAfterStats, resetCloseAfterStatsForTesting } from "./closeAfterStats";

vi.mock("../util/pg", () => ({
  closeIdlePgConnections: vi.fn(async () => undefined),
}));

import { closeIdlePgConnections } from "../util/pg";

afterEach(() => {
  resetCloseAfterStatsForTesting();
  vi.mocked(closeIdlePgConnections).mockClear();
});

describe("closeAfterStats", () => {
  it("closes idle connections after a single stats read", async () => {
    const order: string[] = [];
    vi.mocked(closeIdlePgConnections).mockImplementation(async () => {
      order.push("close");
    });

    await closeAfterStats(async () => {
      order.push("read");
      return "ok";
    });

    expect(order).toEqual(["read", "close"]);
  });

  it("waits until concurrent stats reads finish before closing", async () => {
    let closes = 0;
    vi.mocked(closeIdlePgConnections).mockImplementation(async () => {
      closes += 1;
    });

    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = closeAfterStats(async () => {
      await firstGate;
      return 1;
    });
    const second = closeAfterStats(async () => 2);

    await second;
    expect(closes).toBe(0);

    releaseFirst();
    await first;
    expect(closes).toBe(1);
  });

  it("closes after a failed stats read", async () => {
    await expect(
      closeAfterStats(async () => {
        throw new Error("no connection");
      })
    ).rejects.toThrow("no connection");
    expect(closeIdlePgConnections).toHaveBeenCalledTimes(1);
  });
});
