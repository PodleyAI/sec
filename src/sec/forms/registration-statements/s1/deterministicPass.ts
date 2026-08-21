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
 * **Granularity is the whole contract.** A table is named BARE only when the
 * parse fills every column `persist` writes for it. The moment one column is
 * beyond the parse — hardcoded null, or read from prose the walk never sees —
 * the whole table is named column by column in BOTH sets, and `covers` simply
 * omits the columns the parse cannot supply. A bare name never expands to "all
 * its columns": the two sets are compared as plain strings, so mixing
 * granularities for one table (bare in one set, qualified in the other) makes
 * the pass decline, which is the fail-safe answer in both directions.
 *
 * Without that check a parse that hardcodes the columns it cannot read wins on
 * any non-empty result, and the section resolves clean: the destination is
 * emptied and refilled with a strict subset, no dead letter is recorded, and
 * every replay takes the same path, so nothing ever self-corrects.
 *
 * **Columns are only half of it.** {@link covers} names destinations, so it can
 * say the parse fills every column `persist` writes — never that the parse
 * found every ROW. For a destination holding many rows (`use_of_proceeds`,
 * `spac_sponsor_link`, `beneficial_ownership`) that is the same silent
 * truncation one level up: the caller has already cleared the table, so a walk
 * that reads N of M rows persists N and resolves the section as complete.
 * {@link complete} is therefore required as well — a pass that cannot assert
 * its rows are the whole population does not preempt, and the section costs a
 * model call instead of losing filed rows.
 */
export interface DeterministicPass<TRow> {
  /** Pure and synchronous — no model, no I/O. Returns `[]` when it reads nothing. */
  readonly extract: (text: string) => readonly TRow[];
  /**
   * Destinations this parse fills. See the type doc for the naming convention.
   *
   * A FUNCTION of the section text answers the question a fixed set cannot:
   * whether a column the parse leaves null is a loss or the truth. An ownership
   * table with no "Shares Offered" column has no shares offered, so `null` is
   * what the filing says; the same null against a resale table deletes a
   * disclosed figure. Such a function MUST be derived from the same walk
   * {@link extract} performs — a coverage claim computed from anything else is
   * a second implementation that can disagree with the parse it speaks for.
   * A throw is treated as covering nothing, so the section falls through to the
   * model rather than aborting.
   */
  readonly covers: ReadonlySet<string> | ((text: string) => ReadonlySet<string>);
  /**
   * Whether the returned rows are the section's COMPLETE population — the ROW
   * half of the contract, and a precondition of preempting the model at all.
   * It is also what `SectionPersistMeta.complete` reports and what roster
   * closure keys on.
   *
   * Omitted means false: a parser that filters its own output cannot tell a row
   * it dropped from a row the section never had, so it must not be read as
   * having enumerated everything. Like {@link covers}, an honest answer is
   * derived from the same walk {@link extract} performs — a decline log, not a
   * second reading of the section. A single-valued destination (one row per
   * accession) answers it by the row being there at all.
   */
  readonly complete?: (rows: readonly TRow[], text: string) => boolean;
}

const COVERS_NOTHING: ReadonlySet<string> = new Set<string>();

/**
 * Whether `pass` covers every column of every destination a section rewrites.
 * The COLUMN half of the preemption test — {@link assertsCompletePopulation}
 * is the row half, and both have to hold. Kept separate because this one is
 * answerable before {@link DeterministicPass.extract} runs, so a pass that
 * cannot supply the columns never walks the section at all.
 *
 * An undeclared `clears` is false, not vacuously true: a caller that never said
 * what the section rewrites has not shown the parse can supply it, and the
 * fail-safe answer costs one model call rather than a silently truncated table.
 */
export function preempts<TRow>(
  pass: DeterministicPass<TRow>,
  clears: ReadonlySet<string> | undefined,
  text: string
): boolean {
  if (clears === undefined) return false;
  const covers = resolveCovers(pass.covers, text);
  for (const destination of clears) {
    if (!covers.has(destination)) return false;
  }
  return true;
}

/**
 * Whether `pass` claims `rows` are the section's whole population. A pass that
 * declares no {@link DeterministicPass.complete} claims nothing, which is the
 * fail-safe answer: the model runs.
 *
 * A throw is treated as no claim, for the same reason a throwing coverage
 * function covers nothing — declining costs a model call, while aborting loses
 * a section the model could still have extracted.
 */
export function assertsCompletePopulation<TRow>(
  pass: DeterministicPass<TRow>,
  rows: readonly TRow[],
  text: string
): boolean {
  if (pass.complete === undefined) return false;
  try {
    return pass.complete(rows, text) === true;
  } catch {
    return false;
  }
}

/**
 * A coverage function reads the section itself, so it can fail the way any
 * parse can. Declining is the only safe answer: throwing here would abort a
 * section the model could still have extracted.
 */
function resolveCovers(
  covers: ReadonlySet<string> | ((text: string) => ReadonlySet<string>),
  text: string
): ReadonlySet<string> {
  if (typeof covers !== "function") return covers;
  try {
    return covers(text);
  } catch {
    return COVERS_NOTHING;
  }
}
