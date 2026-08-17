/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { extractSponsorPromote } from "./sectionExtractors";
import { fakeS1Model, registerFakeStructuredProvider } from "./testing/fakeStructuredProvider";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe("extractSponsorPromote", () => {
  it("returns the parsed promote row", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        founder_shares: 5000000,
        founder_percent: 0.2,
        private_placement_warrants: 10000000,
        private_placement_warrant_price: 1.0,
        public_warrant_coverage: 0.5,
        trust_per_public_share: 10.0,
        trust_total: 200000000,
        confidence: 0.92,
        source_span: "our sponsor currently holds 5,000,000 Class B ordinary shares",
      },
    ]);
    cleanup = unregister;
    const text =
      "Our sponsor currently holds 5,000,000 Class B ordinary shares (the founder shares).";
    const row = await extractSponsorPromote(text, fakeS1Model());
    expect(row).not.toBeNull();
    expect(row?.founder_shares).toBe(5000000);
    expect(row?.founder_percent).toBe(0.2);
    expect(row?.private_placement_warrants).toBe(10000000);
    expect(row?.public_warrant_coverage).toBe(0.5);
    expect(row?.trust_per_public_share).toBe(10.0);
    expect(row?.trust_total).toBe(200000000);
  });

  it("returns null when the model cites no source span", async () => {
    // A null source_span drops the row even at high confidence — there is no
    // verbatim anchor for the figures, so the section runner cannot verify it.
    const { unregister } = registerFakeStructuredProvider([
      {
        founder_shares: 1,
        founder_percent: null,
        private_placement_warrants: null,
        private_placement_warrant_price: null,
        public_warrant_coverage: null,
        trust_per_public_share: null,
        trust_total: null,
        confidence: 0.95,
        source_span: null,
      },
    ]);
    cleanup = unregister;
    const row = await extractSponsorPromote("no promote here", fakeS1Model());
    expect(row).toBeNull();
  });

  it("passes through a partial disclosure (only some figures stated)", async () => {
    const { unregister } = registerFakeStructuredProvider([
      {
        founder_shares: null,
        founder_percent: 0.2,
        private_placement_warrants: null,
        private_placement_warrant_price: null,
        public_warrant_coverage: null,
        trust_per_public_share: 10.2,
        trust_total: null,
        confidence: 0.8,
        source_span: "$10.20 per public share will be deposited into the trust account",
      },
    ]);
    cleanup = unregister;
    const row = await extractSponsorPromote(
      "$10.20 per public share will be deposited into the trust account.",
      fakeS1Model()
    );
    expect(row).not.toBeNull();
    expect(row?.founder_shares).toBeNull();
    expect(row?.founder_percent).toBe(0.2);
    expect(row?.trust_per_public_share).toBe(10.2);
  });
});
