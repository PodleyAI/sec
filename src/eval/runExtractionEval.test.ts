/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { EVAL_EXTRACTORS, EVAL_FIXTURES } from "./fixtures";
import { extractorsWithFixtures, runExtractionEval } from "./runExtractionEval";

describe("extractorsWithFixtures", () => {
  it("lists exactly the extractors EVAL_FIXTURES covers", () => {
    const listed = [...extractorsWithFixtures()].sort();
    const actual = [...new Set(EVAL_FIXTURES.map((f) => f.extractor))].sort();
    expect(listed).toEqual(actual);
  });

  it("only names extractors registered in EVAL_EXTRACTORS", () => {
    for (const e of extractorsWithFixtures()) {
      expect(EVAL_EXTRACTORS[e], `fixture references unregistered extractor "${e}"`).toBeDefined();
    }
  });
});

describe("runExtractionEval fixture selection", () => {
  // Registration in EVAL_EXTRACTORS does not imply a committed fixture, and the
  // CLI validates --extractor against that map. Selecting an unfixtured extractor
  // must fail loudly rather than sweep zero runs and report success.
  it("throws for a registered extractor that has no fixtures", async () => {
    const unfixtured = Object.keys(EVAL_EXTRACTORS).find(
      (e) => !EVAL_FIXTURES.some((f) => f.extractor === e)
    );
    if (unfixtured === undefined) return; // every extractor is covered — nothing to assert
    await expect(
      runExtractionEval({ models: ["claude-haiku-4-5"], extractor: unfixtured })
    ).rejects.toThrow(/has no fixtures in EVAL_FIXTURES/);
  });

  it("throws for an unknown extractor rather than scoring nothing", async () => {
    await expect(
      runExtractionEval({ models: ["claude-haiku-4-5"], extractor: "does-not-exist" })
    ).rejects.toThrow(/has no fixtures in EVAL_FIXTURES/);
  });

  // A misspelled --fixture would otherwise sweep zero runs and print an empty
  // table with exit 0 — indistinguishable from a passing evaluation.
  it("throws for a fixture name that matches nothing, listing what is available", async () => {
    const real = EVAL_FIXTURES[0]!.name;
    await expect(
      runExtractionEval({ models: ["claude-haiku-4-5"], fixtures: ["does-not-exist"] })
    ).rejects.toThrow(/no fixture named "does-not-exist"/);
    // The message names the real candidates, so a typo is fixable from the error.
    await expect(
      runExtractionEval({ models: ["claude-haiku-4-5"], fixtures: ["does-not-exist"] })
    ).rejects.toThrow(new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  // The filter composes with --extractor rather than reaching past it: a real
  // fixture belonging to a different extractor must not smuggle itself in.
  it("throws when a named fixture is outside the selected extractor", async () => {
    const management = EVAL_FIXTURES.find((f) => f.extractor === "management");
    const other = EVAL_FIXTURES.find((f) => f.extractor !== "management");
    if (management === undefined || other === undefined) return;
    await expect(
      runExtractionEval({
        models: ["claude-haiku-4-5"],
        extractor: "management",
        fixtures: [other.name],
      })
    ).rejects.toThrow(/no fixture named/);
  });
});
