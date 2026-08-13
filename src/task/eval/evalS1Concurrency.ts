/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `eval s1` fans out on three nested axes — filings, that filing's sections,
 * and the candidate models scoring one section — each with its own flag, so the
 * extractions in flight is at most their **product** (default 1 x 5 x 4 = 20).
 * One number covering all three cannot be set without knowing how it will be
 * spent; three can, and a sweep that takes days is tuned by raising the axis
 * that is actually idle.
 *
 * The product is a ceiling, not a measurement: each axis is separately capped by
 * the work available to it (filing count, that filing's section count, `--models`
 * count). {@link effectiveEvalS1Concurrency} computes what a sweep can actually
 * reach, which is what the reported `lat@…` axes must describe.
 */
export const EVAL_S1_CONCURRENCY_DEFAULTS = {
  s1: 1,
  section: 5,
  sectionModel: 4,
} as const;

export type EvalS1ConcurrencyAxis = keyof typeof EVAL_S1_CONCURRENCY_DEFAULTS;

/** The flag that sets each axis, so a rejected value names what the operator typed. */
export const EVAL_S1_CONCURRENCY_FLAGS: Readonly<Record<EvalS1ConcurrencyAxis, string>> = {
  s1: "--concurrency-s1",
  section: "--concurrency-section",
  sectionModel: "--concurrency-section-model",
};

/** Concurrency in force on each axis for one sweep. */
export interface EvalS1Concurrency {
  /** Filings in flight — the outer map. */
  readonly s1: number;
  /** Sections of one filing in flight — the middle map. */
  readonly section: number;
  /** Candidate models for one section in flight — the inner map. */
  readonly sectionModel: number;
}

/** Resolve one axis. `undefined` → that axis's default. Rejects anything below 1. */
export function resolveEvalS1Concurrency(
  axis: EvalS1ConcurrencyAxis,
  value: number | undefined
): number {
  if (value === undefined) return EVAL_S1_CONCURRENCY_DEFAULTS[axis];
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(
      `${EVAL_S1_CONCURRENCY_FLAGS[axis]} must be an integer >= 1, got ${String(value)}`
    );
  }
  return value;
}

/** Resolve all three axes at once, each falling back to its own default. */
export function resolveEvalS1Concurrencies(requested: {
  readonly s1?: number | undefined;
  readonly section?: number | undefined;
  readonly sectionModel?: number | undefined;
}): EvalS1Concurrency {
  return {
    s1: resolveEvalS1Concurrency("s1", requested.s1),
    section: resolveEvalS1Concurrency("section", requested.section),
    sectionModel: resolveEvalS1Concurrency("sectionModel", requested.sectionModel),
  };
}

/**
 * Candidate models in flight for one section. Bounded by the flag rather than
 * by the candidate count: the inner map ran at `candidates.length`, so naming
 * ten models multiplied the whole sweep by ten with nothing saying so.
 */
export function sectionModelConcurrencyLimit(
  requested: number | undefined,
  candidateCount: number
): number {
  const limit = requested ?? EVAL_S1_CONCURRENCY_DEFAULTS.sectionModel;
  return Math.max(1, Math.min(limit, candidateCount || 1));
}

/** Extractions in flight when all three maps are full. */
export function evalS1ConcurrencyProduct(concurrency: EvalS1Concurrency): number {
  return concurrency.s1 * concurrency.section * concurrency.sectionModel;
}

/** The work each axis actually has to spread across, for {@link effectiveEvalS1Concurrency}. */
export interface EvalS1Workload {
  /** Filings the sweep will run. */
  readonly filings: number;
  /** Sections carried by the widest single filing — the section map is per-filing. */
  readonly maxSectionsPerFiling: number;
  /** Candidate models scoring one section. */
  readonly candidates: number;
}

/**
 * What the three maps can actually reach, given how much work there is.
 *
 * Every axis is clamped downstream — the filing map to `filings.length`, each
 * filing's section map to its own section count, the model map to
 * `candidates.length` — so the requested triple is an upper bound, not a
 * measurement. That matters because the `lat@…` column exists for exactly one
 * purpose: telling whether two latency figures were measured under the same
 * load. A default sweep with the default single `--models` id runs at most
 * `1 x 5 x 1` while the request reads `1 x 5 x 4`, and labeling both runs the
 * same way makes the column claim a comparison it cannot support.
 *
 * The `section` figure is a **maximum**, not a uniform width: the section map is
 * per-filing, so a filing with fewer sections than the limit runs narrower.
 * Callers should render it as "at most N sections".
 */
export function effectiveEvalS1Concurrency(
  requested: EvalS1Concurrency,
  workload: EvalS1Workload
): EvalS1Concurrency {
  const clamp = (limit: number, available: number): number =>
    Math.max(1, Math.min(limit, available));
  return {
    s1: clamp(requested.s1, workload.filings),
    section: clamp(requested.section, workload.maxSectionsPerFiling),
    sectionModel: sectionModelConcurrencyLimit(requested.sectionModel, workload.candidates),
  };
}

/**
 * The axes a latency figure was measured under, for the table's `lat@…` column.
 * Wall-clock per extraction includes time spent queued behind the sweep's own
 * other extractions, so a figure is only comparable with another measured at
 * the same three settings.
 */
export function formatEvalS1Concurrency(concurrency: EvalS1Concurrency): string {
  return `${concurrency.s1}x${concurrency.section}x${concurrency.sectionModel}`;
}
