/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import { Workflow } from "workglow";
import { EvalS1SectionTask } from "./EvalS1SectionTask";
import {
  effectiveEvalS1Concurrency,
  evalS1ConcurrencyProduct,
  formatEvalS1Concurrency,
  resolveEvalS1Concurrencies,
  resolveEvalS1Concurrency,
  sectionModelConcurrencyLimit,
  EVAL_S1_CONCURRENCY_DEFAULTS,
} from "./evalS1Concurrency";
import { EvalS1FilingTask } from "./EvalS1FilingTask";
import {
  beginEvalS1Sweep,
  collectMappedResults,
  groupSectionsByFiling,
  type OracleRunResult,
} from "./evalS1Run";
import type { RealSection } from "../../eval/realSections";

const section = (filing: string, extractor: string): RealSection => ({
  filing,
  extractor,
  text: `${filing}/${extractor}`,
});

describe("resolveEvalS1Concurrency", () => {
  it("defaults each axis independently", () => {
    // The three axes multiply (1 x 5 x 4 = 20 extractions in flight). They are
    // separate flags because one number cannot be spent across them without
    // guessing which one the operator wanted raised.
    expect(EVAL_S1_CONCURRENCY_DEFAULTS).toEqual({ s1: 1, section: 5, sectionModel: 4 });
    expect(resolveEvalS1Concurrency("s1", undefined)).toBe(1);
    expect(resolveEvalS1Concurrency("section", undefined)).toBe(5);
    expect(resolveEvalS1Concurrency("sectionModel", undefined)).toBe(4);
  });

  it("returns a positive integer override", () => {
    expect(resolveEvalS1Concurrency("s1", 3)).toBe(3);
    expect(resolveEvalS1Concurrency("section", 1)).toBe(1);
    expect(resolveEvalS1Concurrency("sectionModel", 8)).toBe(8);
  });

  it("rejects 0, negatives and fractions, naming the flag that was typed", () => {
    // The message has to name the axis: three flags share this validator, and
    // "concurrency must be an integer >= 1" does not say which one to fix.
    expect(() => resolveEvalS1Concurrency("s1", 0)).toThrow(/--concurrency-s1 must be/);
    expect(() => resolveEvalS1Concurrency("section", -1)).toThrow(/--concurrency-section must be/);
    expect(() => resolveEvalS1Concurrency("sectionModel", 1.5)).toThrow(
      /--concurrency-section-model must be/
    );
  });

  it("resolves all three axes at once, mixing overrides with defaults", () => {
    expect(resolveEvalS1Concurrencies({})).toEqual({ s1: 1, section: 5, sectionModel: 4 });
    expect(resolveEvalS1Concurrencies({ section: 2 })).toEqual({
      s1: 1,
      section: 2,
      sectionModel: 4,
    });
  });
});

describe("sectionModelConcurrencyLimit", () => {
  it("caps candidate fan-out by the flag, NOT by how many models were named", () => {
    // The regression this pins: the inner map ran at `candidates.length`, so it
    // was uncapped — `--models` with ten ids put ten extractions in flight per
    // section (and 5 x 10 = 50 across the sweep, not the 20 the defaults state).
    // Naming a model must not be a concurrency decision.
    expect(sectionModelConcurrencyLimit(undefined, 10)).toBe(4);
    expect(sectionModelConcurrencyLimit(undefined, 4)).toBe(4);
    expect(sectionModelConcurrencyLimit(2, 10)).toBe(2);
  });

  it("never asks for more workers than there are candidates", () => {
    expect(sectionModelConcurrencyLimit(4, 2)).toBe(2);
    expect(sectionModelConcurrencyLimit(undefined, 1)).toBe(1);
  });

  it("floors at 1 for a degenerate candidate count", () => {
    expect(sectionModelConcurrencyLimit(undefined, 0)).toBe(1);
    expect(sectionModelConcurrencyLimit(1, 0)).toBe(1);
  });

  it("is what EvalS1SectionTask's candidate map actually runs at", async () => {
    // The helper alone proves nothing if the task keeps passing
    // `candidates.length`, which is precisely what it used to do — so read the
    // limit off the map the task builds. Six unregistered ids: each candidate
    // returns a "not registered" row without an API call, and pre-fix this map
    // was configured with 6.
    const configs: Array<{ concurrencyLimit?: number }> = [];
    const map = Workflow.prototype.map;
    const spy = vi
      .spyOn(Workflow.prototype, "map")
      .mockImplementation(function (this: Workflow, config = {}) {
        configs.push(config as { concurrencyLimit?: number });
        return map.call(this, config);
      });
    try {
      const task = new EvalS1SectionTask({
        defaults: {
          reference: "golden",
          candidates: ["m1", "m2", "m3", "m4", "m5", "m6"],
          dumpRaw: false,
        },
      });
      // The candidate iterations themselves are not the subject and are allowed
      // to fail — no model is registered here — but the map is configured before
      // the first one starts, so the recording below is unaffected either way.
      await task
        .run({ filing: "s1_fixture", extractor: "management", text: "ignored" })
        .catch(() => undefined);
    } finally {
      spy.mockRestore();
    }
    expect(configs).toHaveLength(1);
    expect(configs[0].concurrencyLimit).toBe(EVAL_S1_CONCURRENCY_DEFAULTS.sectionModel);
  });
});

describe("eval s1 concurrency reporting", () => {
  it("states the product — what is actually in flight", () => {
    expect(evalS1ConcurrencyProduct({ s1: 1, section: 5, sectionModel: 4 })).toBe(20);
    expect(evalS1ConcurrencyProduct({ s1: 2, section: 3, sectionModel: 1 })).toBe(6);
  });

  it("labels latency with all three axes", () => {
    // A latency figure is only comparable with one measured at the same
    // settings — wall-clock includes waiting behind the sweep's own work — so
    // the column header carries every axis, not just one of them.
    expect(formatEvalS1Concurrency({ s1: 1, section: 5, sectionModel: 4 })).toBe("1x5x4");
    expect(formatEvalS1Concurrency({ s1: 1, section: 1, sectionModel: 1 })).toBe("1x1x1");
  });
});

describe("effectiveEvalS1Concurrency", () => {
  it("caps the model axis by how many models were actually named", () => {
    // The whole point of the `lat@…` label is comparing two latency figures, so
    // it has to describe the load the sweep RAN at. The default `--models` is a
    // single id, so a bare `sec eval s1` reaches 1x5x1 = 5 in flight while the
    // request reads 1x5x4 = 20 — a four-fold overstatement on the column whose
    // only job is to make the comparison honest.
    expect(
      effectiveEvalS1Concurrency(
        { s1: 1, section: 5, sectionModel: 4 },
        { filings: 42, maxSectionsPerFiling: 12, candidates: 1 }
      )
    ).toEqual({ s1: 1, section: 5, sectionModel: 1 });
  });

  it("caps the filing axis by the corpus, not the request", () => {
    // `--cik` narrowing a sweep to one filing cannot run 4 filings at once.
    expect(
      effectiveEvalS1Concurrency(
        { s1: 4, section: 5, sectionModel: 4 },
        { filings: 1, maxSectionsPerFiling: 12, candidates: 4 }
      )
    ).toEqual({ s1: 1, section: 5, sectionModel: 4 });
  });

  it("caps the section axis by the widest filing", () => {
    // The section map is per-filing, so this figure is a MAXIMUM across filings
    // — a filing with fewer sections runs narrower, which is why callers render
    // it as "at most N sections".
    expect(
      effectiveEvalS1Concurrency(
        { s1: 1, section: 5, sectionModel: 4 },
        { filings: 3, maxSectionsPerFiling: 2, candidates: 4 }
      )
    ).toEqual({ s1: 1, section: 2, sectionModel: 4 });
  });

  it("leaves a request the workload can satisfy untouched", () => {
    expect(
      effectiveEvalS1Concurrency(
        { s1: 2, section: 3, sectionModel: 2 },
        { filings: 42, maxSectionsPerFiling: 12, candidates: 4 }
      )
    ).toEqual({ s1: 2, section: 3, sectionModel: 2 });
  });

  it("floors every axis at 1 for a degenerate workload", () => {
    // An empty corpus reports 1x1x1 rather than 0 — a zero would render as
    // "lat@0x0x0" and divide-by-zero any product printed beside it.
    expect(
      effectiveEvalS1Concurrency(
        { s1: 1, section: 5, sectionModel: 4 },
        { filings: 0, maxSectionsPerFiling: 0, candidates: 0 }
      )
    ).toEqual({ s1: 1, section: 1, sectionModel: 1 });
  });
});

describe("groupSectionsByFiling", () => {
  it("gives --concurrency-s1 a filing axis to bound", () => {
    // The corpus loads as a flat list of sections across every filing, so there
    // was no filing layer to limit before grouping.
    const groups = groupSectionsByFiling([
      section("s1_a", "management"),
      section("s1_b", "management"),
      section("s1_a", "risk-factors"),
    ]);
    expect(groups.map((g) => g.filing)).toEqual(["s1_a", "s1_b"]);
    expect(groups[0].sections.map((s) => s.extractor)).toEqual(["management", "risk-factors"]);
    expect(groups[1].sections).toHaveLength(1);
  });

  it("preserves first-seen filing order and loses no section", () => {
    // Grouping is what makes an interrupted sweep leave whole filings behind
    // rather than a scatter of partly-covered ones, so it must not reorder or
    // drop the corpus.
    const sections = [
      section("s1_c", "management"),
      section("s1_a", "management"),
      section("s1_c", "underwriters"),
      section("s1_b", "management"),
    ];
    const groups = groupSectionsByFiling(sections);
    expect(groups.map((g) => g.filing)).toEqual(["s1_c", "s1_a", "s1_b"]);
    expect(groups.reduce((n, g) => n + g.sections.length, 0)).toBe(sections.length);
  });

  it("returns nothing for an empty corpus", () => {
    expect(groupSectionsByFiling([])).toEqual([]);
  });
});

describe("EvalS1FilingTask", () => {
  it("iterates one filing per outer-map step, keeping that filing's sections together", async () => {
    // The filing layer is what `--concurrency-s1` bounds, and it only works if
    // each iteration receives that filing's own section list — the outer map
    // passes arrays-of-arrays, one array per filing. Golden reference with no
    // candidates keeps this free of model calls.
    beginEvalS1Sweep();
    const wf = new Workflow();
    const loop = wf.map({
      concurrencyLimit: 1,
      maxIterations: 2,
      preserveOrder: true,
      flatten: true,
    });
    loop.pipe(
      new EvalS1FilingTask({
        defaults: { reference: "golden", candidates: [], dumpRaw: false },
      })
    );
    loop.endMap();
    const out = await wf.run({
      filing: ["s1_a", "s1_b"],
      extractors: [["management", "underwriters"], ["management"]],
      texts: [["a-management", "a-underwriters"], ["b-management"]],
    });

    const results = collectMappedResults<OracleRunResult>(out);
    expect(results.map((r) => `${r.filing}/${r.extractor}`)).toEqual([
      "s1_a/management",
      "s1_a/underwriters",
      "s1_b/management",
    ]);
  });
});
