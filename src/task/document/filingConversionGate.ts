/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MaybeDurable } from "../../util/sqlBackend";

/** The dialect and position a gate writes one SQL fragment for. */
export interface GateSqlRequest {
  readonly backend: "sqlite" | "postgres";
  /** Alias of the `filings` row the fragment correlates against. */
  readonly filingAlias: string;
  /**
   * Placeholder number of the fragment's FIRST parameter, for the backend that
   * numbers them (`$n`). SQLite numbers `?` by position, so a fragment there
   * binds its parameters simply by returning them in order.
   */
  readonly firstParamIndex: number;
}

/** One boolean SQL expression and the parameters it binds, in statement order. */
export interface GateSqlFragment {
  readonly sql: string;
  readonly params: readonly (string | number)[];
}

/**
 * A gate's pushed-down form: the expression, plus the storage it reads.
 *
 * The storage is what decides whether the fast path may be taken at all — an
 * in-memory binding is invisible to `getDb()` / `getPgPool()`, so a query
 * naming its table would read a database the caller never populated. It is
 * handed to `resolveSqlBackend` alongside the sweep's own two storages rather
 * than judged here, so one rule answers for all of them.
 */
export interface GateSqlPushdown {
  readonly storage: MaybeDurable | undefined;
  readonly fragment: (request: GateSqlRequest) => GateSqlFragment;
}

/**
 * Which filers' filings of the gated forms are worth converting.
 *
 * The forms themselves are this package's call — see `SPAC_GATED_FORMS` for why
 * 8-Ks cannot be converted for everyone — but the filer set is not. It comes
 * from a lifecycle model that need not live here, so a package that owns one
 * contributes it through {@link registerFilingConversionGate} and a package
 * without one selects no gated filings at all.
 *
 * Two members because the sweep has two routes to the same rule and they must
 * not drift: raw SQL on a durable backend, and a stream over
 * `ITabularStorage` everywhere else. {@link pushdown} serves the first and is
 * allowed to decline; {@link admittedCiks} serves the second and always
 * answers.
 */
export interface FilingConversionGate {
  /**
   * Every CIK the gate admits, materialized for the repository path — that path
   * already streams every filing, so one set beats a lookup per row.
   */
  readonly admittedCiks: () => Promise<ReadonlySet<number>>;
  /**
   * The same rule as a SQL fragment, or undefined when it cannot be pushed into
   * the query. Undefined is not "admit everyone": it sends the whole selection
   * to the repository path, where {@link admittedCiks} applies the gate against
   * a full stream. Resolved per call, because what a gate can push down depends
   * on how its storage is bound at the time.
   */
  readonly pushdown: () => GateSqlPushdown | undefined;
}

/**
 * The contributed gate, or undefined when nothing registered one.
 *
 * One gate rather than a keyed set: there is one question here, and a package
 * that wants the union of two filer sets composes it in the gate it registers.
 */
let registeredGate: FilingConversionGate | undefined;

/**
 * Contribute the gate the documents sweep applies to {@link SPAC_GATED_FORMS}.
 *
 * Registering one is the only signal this package has that a deployment can
 * name the filers whose 8-Ks are worth a corpus of markdown. Idempotent; the
 * last registration stands.
 */
export function registerFilingConversionGate(gate: FilingConversionGate): void {
  registeredGate = gate;
}

/** Test hook: forget the contributed gate. */
export function clearFilingConversionGateForTesting(): void {
  registeredGate = undefined;
}

/** The gate the sweep should apply, or undefined when none was contributed. */
export function filingConversionGate(): FilingConversionGate | undefined {
  return registeredGate;
}
