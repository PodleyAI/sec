/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Human-verified "truth" for the committed real S-1 sections, used by
 * `sec eval s1 --reference golden`. A live reference model (even sonnet) is not
 * ground truth — it drops or invents the odd role — which caps achievable
 * agreement and can penalize a correct candidate. For the small committed set we
 * hand-label the roster so the oracle measures **correctness**, not agreement
 * with a wandering model.
 *
 * Titles are written in the **canonical post-normalization** form
 * ({@link normalizeManagementTitles} output), because a candidate's rows are
 * normalized before scoring: split into distinct roles, board seats rendered as
 * "Director", a bare board chair expanded to "… of the Board of Directors", and
 * nominees marked ("Director Nominee" / "… (Nominee)"). Names are written as the
 * filing's roster table shows them; the scorer folds case/punctuation so
 * "Richard J Boyle, Jr." and "Richard J Boyle Jr" align.
 *
 * Rosters were read from BOTH the summary table and the bio's "has served as
 * our …" sentence (roles at THIS company), taking the union — e.g. John Lewis'
 * table cell is "Chief Financial Officer" but his bio adds "and Secretary".
 */
export interface GoldenRow {
  readonly full_name: string;
  readonly titles: readonly string[];
}

/** Key a golden entry by `${filing}::${extractor}` (filing = accession-derived basename). */
export function goldenLabelKey(filing: string, extractor: string): string {
  return `${filing}::${extractor}`;
}

const G = (full_name: string, titles: readonly string[]): GoldenRow => ({ full_name, titles });

/**
 * Committed golden labels, keyed by {@link goldenLabelKey}. Only sections that
 * appear here are scored under `--reference golden`; everything else is skipped.
 * Currently the four committed `management` sections.
 */
export const GOLDEN_S1_LABELS: Readonly<Record<string, readonly GoldenRow[]>> = {
  // Operating/SPAC IPO — 26 Capital Acquisition Corp.
  [goldenLabelKey("s1_1822912_000121390021001475", "management")]: [
    G("Jason Ader", ["Chief Executive Officer", "Chairman of the Board of Directors"]),
    // table: "Chief Financial Officer"; bio: "has served as our CFO and Secretary"
    G("John Lewis", ["Chief Financial Officer", "Secretary"]),
    G("Rafi Ashkenazi", ["Director Nominee"]),
    G("Joseph Kaminkow", ["Director Nominee"]),
    G("Gregory S. Lyss", ["Director Nominee"]),
  ],
  // Small SPAC roster — BOWEN ACQUISITION / Martire founder vehicle.
  [goldenLabelKey("s1_1848507_000119312521066104", "management")]: [
    G("Frank R. Martire, Jr.", ["Founder", "Chairman of the Board of Directors"]),
    G("Frank Martire, III", ["President"]),
    G("Tanmay Kumar", ["Chief Financial Officer"]),
    G("Howard Chatzinoff", ["Director Nominee"]),
    G("Frank D’Angelo", ["Director Nominee"]),
    G("Rachel Landrum", ["Director Nominee"]),
    G("Don Layden", ["Director Nominee"]),
    G("Patricia A. Oelrich", ["Director Nominee"]),
    G("Tom Shen", ["Director Nominee"]),
  ],
  // Real-estate SPAC — Watson/Bloemker seated; Haldeman + others are nominees.
  [goldenLabelKey("s1_1849470_000110465921035696", "management")]: [
    G("Gregor Watson", ["Chief Executive Officer", "Director"]),
    G("Rob Bloemker", ["Chief Financial Officer", "Secretary", "Director"]),
    // Cell: "Director and Chairman of the Board nominee" — a seated Director who
    // is a Chairman nominee. The filing labels the pure nominees distinctly
    // ("Director nominee"), and sonnet, gpt-5.4-mini, and gemini all independently
    // read the "Director" here as seated, so we take that (not "Director Nominee").
    G("Charles E. Haldeman Jr.", [
      "Director",
      "Chairman of the Board of Directors (Nominee)",
    ]),
    G("Jacob Seid", ["Director Nominee"]),
    G("Suzanne Klahr", ["Director Nominee"]),
    G("Richard J Boyle, Jr.", ["Director Nominee"]),
  ],
  // Churchill Capital Corp XII (large SPAC).
  [goldenLabelKey("s1_2114227_000121390026039320", "management")]: [
    G("Michael Klein", [
      "Chief Executive Officer",
      "President",
      "Chairman of the Board of Directors",
    ]),
    G("Jay Taragin", ["Chief Financial Officer"]),
    G("William Sherman", ["Director Nominee"]),
  ],
};

/** Golden rows for one section, or undefined when the section is unlabeled. */
export function getGoldenLabels(
  filing: string,
  extractor: string
): readonly GoldenRow[] | undefined {
  return GOLDEN_S1_LABELS[goldenLabelKey(filing, extractor)];
}
