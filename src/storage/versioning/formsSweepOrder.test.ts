/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { FORM_TO_EXTRACTOR_ID, sortFormsForSweep } from "./extractorIds";

/** Index of the first form in `order` routed to `extractorId`. */
function firstIndexOf(order: readonly string[], extractorId: string): number {
  const i = order.findIndex((form) => FORM_TO_EXTRACTOR_ID[form] === extractorId);
  expect(i).toBeGreaterThanOrEqual(0);
  return i;
}

describe("sortFormsForSweep", () => {
  it("runs S-1 before 424 before 8-K before proxies before 25/15", () => {
    // Object key order puts the integer-like "25" fourth overall, so a first-pass
    // sweep processed every issuer-filed Form 25 before its S-1 had minted the
    // spac row the deregistration handler is gated on.
    const order = sortFormsForSweep(Object.keys(FORM_TO_EXTRACTOR_ID));
    const s1 = firstIndexOf(order, "S-1");
    const p424 = firstIndexOf(order, "424");
    const eightK = firstIndexOf(order, "8-K");
    const proxy = firstIndexOf(order, "merger-proxy");
    const dereg = firstIndexOf(order, "25-15");
    expect(s1).toBeLessThan(p424);
    expect(p424).toBeLessThan(eightK);
    expect(eightK).toBeLessThan(proxy);
    expect(proxy).toBeLessThan(dereg);
  });

  it("puts every ranked form ahead of every unranked one", () => {
    const order = sortFormsForSweep(Object.keys(FORM_TO_EXTRACTOR_ID));
    const ranked = new Set(["S-1", "424", "8-K", "merger-proxy", "25-15"]);
    const lastRanked = order.reduce(
      (acc, form, i) => (ranked.has(FORM_TO_EXTRACTOR_ID[form]) ? i : acc),
      -1
    );
    const firstUnranked = order.findIndex((form) => !ranked.has(FORM_TO_EXTRACTOR_ID[form]));
    expect(firstUnranked).toBeGreaterThan(lastRanked);
  });

  it("keeps every form exactly once, so a newly wired form cannot be dropped", () => {
    const forms = Object.keys(FORM_TO_EXTRACTOR_ID);
    const order = sortFormsForSweep(forms);
    expect(order.length).toBe(forms.length);
    expect(new Set(order)).toEqual(new Set(forms));
  });

  it("is stable within a rank, so S-1 precedes S-1/A precedes DRS", () => {
    const order = sortFormsForSweep(Object.keys(FORM_TO_EXTRACTOR_ID));
    expect(order.indexOf("S-1")).toBeLessThan(order.indexOf("S-1/A"));
    expect(order.indexOf("S-1/A")).toBeLessThan(order.indexOf("DRS"));
  });

  it("orders an explicit form subset too", () => {
    expect(sortFormsForSweep(["25", "8-K", "S-1"])).toEqual(["S-1", "8-K", "25"]);
  });

  it("leaves a form with no registered extractor at the end rather than dropping it", () => {
    // The caller filters unregistered forms itself (and warns); the sort must
    // not silently swallow one before that happens.
    expect(sortFormsForSweep(["NOT-A-FORM", "25", "S-1"])).toEqual(["S-1", "25", "NOT-A-FORM"]);
  });
});
