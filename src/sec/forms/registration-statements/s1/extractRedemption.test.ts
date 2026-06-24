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

  it("returns null for a figure-less response (no shares and no amount)", async () => {
    // The prompt tells the model to return confidence 0 with null fields when no
    // realized redemption is present; even with a span, a row carrying neither a
    // share count nor a dollar amount is not a redemption and must not persist.
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: null,
        redemption_amount: null,
        price_per_share: null,
        confidence: 0,
        source_span: "no public shares were tendered for redemption",
      },
    ]);
    cleanup = unregister;
    const row = await extractRedemption(
      "No public shares were tendered for redemption.",
      fakeS1Model()
    );
    expect(row).toBeNull();
  });

  it("rejects a negative redemption amount via schema validation", async () => {
    // A sign-error / hallucinated negative amount would otherwise subtract from
    // total_redemption_amount; minimum:0 makes runStructured throw so the caller
    // dead-letters it instead of persisting corrupt data.
    const { unregister } = registerFakeStructuredProvider([
      {
        redemption_shares: 100,
        redemption_amount: -8_200_000,
        price_per_share: null,
        confidence: 0.9,
        source_span: "shares redeemed",
      },
    ]);
    cleanup = unregister;
    await expect(extractRedemption("shares redeemed", fakeS1Model())).rejects.toThrow();
  });
});
