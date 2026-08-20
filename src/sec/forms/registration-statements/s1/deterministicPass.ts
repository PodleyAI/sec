/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A model-free parse of one prospectus section: pure, synchronous, and never
 * calling a provider. A pass that qualifies replaces the AI call entirely for
 * that section, which is why it has to declare what it can supply.
 *
 * {@link covers} names the destinations the parse fills. It is compared against
 * the section's `clears` set — every destination the section rewrites, whether
 * emptied before the run or overwritten in place by `persist` — and the parse
 * may only stand in for the model when it covers all of them. Names are
 * free-form and matched as plain strings, so a destination can be a table
 * (`related_party_transaction`), a column (`spac.description`), or a qualified
 * child (`field_provenance:issuer_ticker`); the two sets of one section simply
 * have to use the same spelling.
 *
 * Without that check a parse that hardcodes the columns it cannot read wins on
 * any non-empty result, and the section resolves clean: the destination is
 * emptied and refilled with a strict subset, no dead letter is recorded, and
 * every replay takes the same path, so nothing ever self-corrects.
 */
export interface DeterministicPass<TRow> {
  /** Pure and synchronous — no model, no I/O. Returns `[]` when it reads nothing. */
  readonly extract: (text: string) => readonly TRow[];
  /** Destinations this parse fills. See the type doc for the naming convention. */
  readonly covers: ReadonlySet<string>;
  /**
   * Whether the returned rows are the section's COMPLETE population, which is
   * what `SectionPersistMeta.complete` reports and what roster closure keys on.
   * Omitted means false: a parser that filters its own output cannot tell a row
   * it dropped from a row the section never had, so it must not be read as
   * having enumerated everything.
   */
  readonly complete?: (rows: readonly TRow[], text: string) => boolean;
}

/**
 * Whether `pass` may stand in for the model on a section that rewrites
 * `clears`. True only when `covers` is a superset of `clears`.
 *
 * An undeclared `clears` is false, not vacuously true: a caller that never said
 * what the section rewrites has not shown the parse can supply it, and the
 * fail-safe answer costs one model call rather than a silently truncated table.
 */
export function preempts<TRow>(
  pass: DeterministicPass<TRow>,
  clears: ReadonlySet<string> | undefined
): boolean {
  if (clears === undefined) return false;
  for (const destination of clears) {
    if (!pass.covers.has(destination)) return false;
  }
  return true;
}
