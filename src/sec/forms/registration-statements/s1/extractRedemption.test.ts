/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "bun:test";
import { extractRedemption } from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("extractRedemption", () => {
  it("returns the parsed redemption row", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: 1234567,
        redemption_amount: 12400000,
        price_per_share: 10.05,
        confidence: 0.9,
        source_span: "1,234,567 shares elected to redeem for $12,400,000",
      },
    ]);
    cleanup = unregister;
    const text = "Holders of 1,234,567 shares elected to redeem for $12,400,000.";
    const row = await extractRedemption(text, fakeS1Model());
    expect(row).not.toBeNull();
    expect(row?.redemption_shares).toBe(1234567);
    expect(row?.redemption_amount).toBe(12400000);
  });

  it("returns null when the model cites no source span", async () => {
    // The null source_span is what drops the row — even a confident response is
    // discarded without a verbatim span to anchor it (any confidence floor lives
    // in the section runner, not here).
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: null,
        redemption_amount: null,
        price_per_share: null,
        confidence: 0.95,
        source_span: null,
      },
    ]);
    cleanup = unregister;
    const row = await extractRedemption("no redemption here", fakeS1Model());
    expect(row).toBeNull();
  });
});
