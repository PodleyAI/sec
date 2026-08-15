/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { normalizeFamilyName } from "./FamilyResolver";

describe("normalizeFamilyName", () => {
  it("upper-cases a hyphen-joined slug", () => {
    // The key is `companyFamilyName`'s slug, upper-cased: hyphen-joined rather
    // than space-separated, so it is stable to whitespace by construction.
    expect(normalizeFamilyName("Goldman Sachs")).toBe("GOLDMAN-SACHS");
    expect(normalizeFamilyName("Pershing Square Sponsor")).toBe("PERSHING-SQUARE-SPONSOR");
  });

  it("drops the legal form and series marker that separate two vehicles", () => {
    // What makes a family rebuildable from the legal name: the vehicle-level
    // differences go, so the roman numeral no longer mints a second family.
    expect(normalizeFamilyName("Churchill Sponsor XIII LLC")).toBe("CHURCHILL-SPONSOR");
    expect(normalizeFamilyName("Churchill Sponsor XIV LLC")).toBe("CHURCHILL-SPONSOR");
  });

  it("keeps business-line words apart, leaving that join to an alias", () => {
    // `Acme Capital` and `Acme Ventures` can be two firms, so the normalizer
    // does not guess. `Chardan Capital Markets` -> `Chardan` is an alias.
    expect(normalizeFamilyName("Acme Capital")).not.toBe(normalizeFamilyName("Acme Ventures"));
    expect(normalizeFamilyName("Chardan Capital Markets LLC")).not.toBe(
      normalizeFamilyName("Chardan")
    );
  });

  it("is case-insensitive (folds upper / lower / mixed to the same key)", () => {
    const upper = normalizeFamilyName("GOLDMAN SACHS");
    const lower = normalizeFamilyName("goldman sachs");
    const mixed = normalizeFamilyName("Goldman Sachs");
    expect(upper).toBe(lower);
    expect(lower).toBe(mixed);
  });

  it("collapses internal whitespace", () => {
    expect(normalizeFamilyName("Goldman   Sachs")).toBe("GOLDMAN-SACHS");
  });

  it("returns '' for empty / whitespace-only / null-normalized input", () => {
    expect(normalizeFamilyName("")).toBe("");
    expect(normalizeFamilyName("   ")).toBe("");
  });

  it("returns '' for a CJK-only name (family keys are ASCII slugs)", () => {
    // companyFamilyName drops non-ASCII, so a Chinese underwriter/sponsor legal
    // name that observeCompany accepts has no family key. Persist must skip
    // resolve rather than throw "empty name" and abort the rest of the section.
    expect(normalizeFamilyName("中信证券股份有限公司")).toBe("");
  });
});
