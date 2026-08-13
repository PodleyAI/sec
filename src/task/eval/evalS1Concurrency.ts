/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `eval s1` fans out on three nested axes — filings, that filing's sections,
 * and the candidate models scoring one section — each with its own flag, so the
 * extractions actually in flight is their **product** (default 1 x 5 x 4 = 20).
 * One number covering all three cannot be set without knowing how it will be
 * spent; three can, and a sweep that takes days is tuned by raising the axis
 * that is actually idle.
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

/**
 * The axes a latency figure was measured under, for the table's `lat@…` column.
 * Wall-clock per extraction includes time spent queued behind the sweep's own
 * other extractions, so a figure is only comparable with another measured at
 * the same three settings.
 */
export function formatEvalS1Concurrency(concurrency: EvalS1Concurrency): string {
  return `${concurrency.s1}x${concurrency.section}x${concurrency.sectionModel}`;
}
