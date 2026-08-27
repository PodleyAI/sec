/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from "vitest";
import { sectionlessResolvableSections } from "./Form_S_1.storage";
import { offeringSectionNames } from "./s1/offeringSections";
import { S1_SECTIONS } from "../../html/sectionVocabulary";

/**
 * A Rule 462(b) form (`S-1MEF` / `F-1MEF`) returns before the section sweep, so
 * it never reaches the per-section `markResolved` inside `runSection`. It
 * instead resolves the whole set up front, which only works while that set
 * remains a SUPERSET of what a sweep can record — a section added to the sweep
 * but not here would sit pending forever: nothing re-attempts it (the form
 * early-returns) and nothing resolves it.
 */
describe("sectionlessResolvableSections", () => {
  // Mirrors the section list the `!model` path dead-letters, which is the
  // broadest set any single run produces.
  const sweepSections = (isSpac: boolean): readonly string[] => [
    S1_SECTIONS.MANAGEMENT,
    S1_SECTIONS.BENEFICIAL_OWNERSHIP,
    S1_SECTIONS.RELATED_PARTY,
    S1_SECTIONS.EXECUTIVE_COMPENSATION,
    "risk-factors",
    ...offeringSectionNames(isSpac),
    ...(isSpac ? ["spac-profile", "spac-sponsors"] : []),
    "spac-classification",
  ];

  it.each([true, false])("covers every section a sweep records (isSpac=%s)", (isSpac) => {
    const resolvable = new Set(sectionlessResolvableSections());
    for (const section of sweepSections(isSpac)) {
      expect(resolvable, `sweep records "${section}" but it is never resolved`).toContain(section);
    }
  });

  it("covers the `-partial` sibling of every section", () => {
    const resolvable = new Set(sectionlessResolvableSections());
    for (const section of sweepSections(true)) {
      expect(resolvable).toContain(`${section}-partial`);
    }
  });

  it("ignores isSpac, so a filing reclassified between runs still resolves", () => {
    // isSpac comes from SIC code plus heuristics and can differ from the run
    // that swept; the SPAC-only names must be present either way.
    const resolvable = new Set(sectionlessResolvableSections());
    expect(resolvable).toContain("spac-profile");
    expect(resolvable).toContain("spac-sponsors");
    expect(resolvable).toContain("sponsor-promote");
  });
});
