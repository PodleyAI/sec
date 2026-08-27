/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SpacCandidate,
  SpacCandidateConfidence,
} from "../../storage/spac/SpacCandidateSchema";

/** SIC 6770, "Blank Checks" — EDGAR's code for a shell with no operations yet. */
export const BLANK_CHECK_SIC = 6770;

/**
 * Securities Act registration forms that a blank check IPOs on. The "S-1"
 * extractor lists every one of them in its form-extractor registration, so the
 * registry routes them all to it:
 *
 * - `S-1` / `S-1/A` / `S-1MEF` — domestic registration
 * - `F-1` / `F-1/A` / `F-1MEF` — foreign private issuer (many SPACs are Cayman)
 * - `DRS` / `DRS/A`            — the confidential draft that, since 2017,
 *                                precedes most IPO registrations
 *
 * Deliberately excludes `10-12G` / `10SB12G`: a company that registers there is
 * a Form 10 shell heading for a reverse merger, not a SPAC raising an IPO.
 */
export const SPAC_REGISTRATION_FORMS = [
  "S-1",
  "S-1/A",
  "S-1MEF",
  "F-1",
  "F-1/A",
  "F-1MEF",
  "DRS",
  "DRS/A",
] as const;

/**
 * Lowercase `LIKE` patterns a blank-check name must match.
 *
 * Kept as SQL patterns because the bulk scan pushes them into the database;
 * {@link looksLikeBlankCheckName} applies the identical lists in JS so the
 * repository fallback and the unit tests agree with the SQL path.
 *
 * "acquisition" is deliberately loose on what sits between the words — sponsors
 * number their vehicles freely ("Unite Acquisition 3 Corp.", "R&R ACQUISITION
 * I, INC", "Chardan Healthcare Acquisition 2 Corp"), so anchoring on
 * "acquisition corp" as one phrase drops a large slice of the population.
 *
 * The rest were measured against EDGAR's own coding: over entities that filed
 * an S-1-family registration, the share whose `entities.sic` is 6770 today.
 * That share *understates* precision, since a de-SPAC's SIC has already moved
 * off 6770 and counts as a miss.
 *
 * | pattern              | 6770 / matched | note                                |
 * | -------------------- | -------------- | ----------------------------------- |
 * | `%acquisition%`      | 1099 / 1342    | the anchor                          |
 * | `%partnering corp%`  |       5 / 5    | "Corsair Partnering Corp"           |
 * | `%opportunit%corp%`  |     15 / 17    | "Elliott Opportunity II Corp."      |
 * | `%growth corp%`      |     12 / 14    | "Juniper Growth CORP"               |
 * | `%merger corp%`      |     16 / 23    | misses are drifted-SIC SPACs        |
 *
 * Rejected on the same measurement: `%capital corp%` (31/99 — Sprint Capital,
 * BBX Capital, and other lenders), `%investment corp%` (BDCs and mortgage
 * REITs), `%holdings corp%` (19/153), `%ventures corp%`, `%spac%` (matches
 * "space"). A SPAC named "… Capital Corp" is therefore only found while its
 * SIC still reads 6770 — see the recall note in CLAUDE.md.
 */
export const BLANK_CHECK_NAME_PATTERNS = [
  "%acquisition%",
  "%blank check%",
  "%partnering corp%",
  "%opportunit%corp%",
  "%growth corp%",
  "%merger corp%",
] as const;

/**
 * Patterns that disqualify an otherwise-matching name.
 *
 * Only legal forms that a blank check cannot take: "RIFKIN ACQUISITION PARTNERS
 * LLLP" and "Inergy Acquisition Company, LLC" are LBO and holding vehicles, and
 * a SPAC is always incorporated (Corp / Inc / Ltd). Among registrants, ` llc`
 * excludes 21 names of which only one is coded 6770.
 *
 * Notably NOT excluded: a bare "partners". Sponsors put their firm's name in
 * front — "Supernova Partners Acquisition Co III", "Catalyst Partners
 * Acquisition Corp." — and of the 13 registrants matching both "acquisition"
 * and "partners" without an LP/LLC suffix, 12 are coded 6770.
 */
export const BLANK_CHECK_NAME_EXCLUSIONS = [
  "%partnership%",
  "% lp%",
  "% llp%",
  "% lllp%",
  "% llc%",
  // Transaction merger subsidiaries ("Bleichroeder Acquisition France Merger
  // Sub 2", "AECOM Merger Subsidiary") are not SPACs. `%merger corp%` stays a
  // positive pattern — Legato Merger Corp. and its series are blank checks.
  "%merger sub%",
  "%merger subsidiary%",
] as const;

/**
 * A second, weaker naming class: conventions that are strongly SPAC-shaped in
 * the modern era but were ordinary finance-company names before it.
 *
 * Measured against embarc's curated SPAC list rather than SIC, because these
 * name a population whose SIC has usually already moved on. Restricted to
 * registrations in 2019-2024 — the window where that list is dense enough for
 * non-membership to mean something — they are strong:
 *
 * | pattern             | in list / matched | over all vintages |
 * | ------------------- | ----------------- | ----------------- |
 * | `%special purpose%` |          5 / 5    |         6 / 7     |
 * | `%investment corp%` |        37 / 40    |       38 / 57     |
 * | `%capital corp%`    |        29 / 32    |      33 / 103     |
 *
 * That last column is why they are weak rather than strong: over all vintages
 * `%capital corp%` collapses to 32%, because "Capital Corp" is also what
 * lenders, BDCs and insurers called themselves — SPRINT CAPITAL CORP, BBX
 * CAPITAL CORP, EVEREN CAPITAL CORP, UniCapital. A weak match alone therefore
 * caps a candidate at `medium`; it takes SIC 6770 or a strong name to reach
 * `high`.
 *
 * Rejected even in the dense window: `%holdings corp%` (29/54 — Gores Holdings
 * and Tuscan Holdings are SPACs, but so is every third operating company),
 * `%technology group%` (9/25), `%holdings inc%` (16/82).
 */
export const MODERN_SPAC_NAME_PATTERNS = [
  "%capital corp%",
  "%investment corp%",
  "%special purpose%",
] as const;

/**
 * JS twin of SQL `LIKE` for the `%`-only patterns above: every segment between
 * the wildcards must appear, in order. (`_` is not used and not supported.)
 */
function likeMatches(lowerName: string, pattern: string): boolean {
  let cursor = 0;
  for (const segment of pattern.split("%")) {
    if (segment.length === 0) continue;
    const found = lowerName.indexOf(segment, cursor);
    if (found === -1) return false;
    cursor = found + segment.length;
  }
  return true;
}

/** JS twin of {@link BLANK_CHECK_NAME_PATTERNS} / {@link BLANK_CHECK_NAME_EXCLUSIONS}. */
export function looksLikeBlankCheckName(name: string | null | undefined): boolean {
  return matchesNamePatterns(name, BLANK_CHECK_NAME_PATTERNS);
}

/** JS twin of {@link MODERN_SPAC_NAME_PATTERNS}, same exclusions. */
export function looksLikeModernSpacName(name: string | null | undefined): boolean {
  return matchesNamePatterns(name, MODERN_SPAC_NAME_PATTERNS);
}

/** True for either naming class — the net the bulk scan casts. */
export function looksLikeSpacName(name: string | null | undefined): boolean {
  return looksLikeBlankCheckName(name) || looksLikeModernSpacName(name);
}

function matchesNamePatterns(
  name: string | null | undefined,
  patterns: readonly string[]
): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  if (!patterns.some((p) => likeMatches(lower, p))) return false;
  return !BLANK_CHECK_NAME_EXCLUSIONS.some((p) => likeMatches(lower, p));
}

/** Per-CIK facts the scan collects; the classifier turns these into a row. */
export interface SpacCandidateFacts {
  readonly cik: number;
  readonly name: string | null;
  readonly current_sic: number | null;
  /**
   * Whether a PARSED registration of this filer carried a 6770 header SIC.
   * Null when none has been parsed — not the same as false.
   */
  readonly filed_sic_6770: boolean | null;
  /**
   * `is_spac` on the latest parsed registration, by filing date. Null when
   * none has been parsed — not the same as false, which is a verdict that
   * this filer is not a blank check.
   */
  readonly classified_as_spac: boolean | null;
  /** Earliest {@link SPAC_REGISTRATION_FORMS} filing, if any. */
  readonly first_reg_form: string | null;
  readonly first_reg_date: string | null;
  /** A former name that looked like a blank check (earliest such). */
  readonly renamed_from: string | null;
  /**
   * When the entity stopped carrying a blank-check name — the LAST such
   * interval's `valid_to`, not the first: EDGAR records cosmetic variants
   * ("Corp." → "Corp") as separate intervals, and the earliest one ends while
   * the company is still very much a SPAC.
   *
   * Consulted only when {@link name} no longer matches either naming class. A
   * company still carrying the name has not renamed away from it, so a closed
   * interval on it describes a variant it kept, not an era it left.
   */
  readonly spac_name_ended: string | null;
}

/** One `s1_classification` row, enough to pick the latest `is_spac` per CIK. */
export interface ClassificationVerdict {
  readonly accession_number: string;
  readonly is_spac: boolean;
  readonly created_at: string;
}

/**
 * `is_spac` of the latest registration, or null when none has been parsed.
 * Filing date wins; `created_at` then accession break ties and stand in when
 * the filing row is missing.
 */
export function latestClassifiedAsSpac(
  rows: readonly ClassificationVerdict[],
  filingDateByAccession: ReadonlyMap<string, string>
): boolean | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]!;
    if (isLaterClassification(row, best, filingDateByAccession)) best = row;
  }
  return best.is_spac;
}

function isLaterClassification(
  a: ClassificationVerdict,
  b: ClassificationVerdict,
  filingDateByAccession: ReadonlyMap<string, string>
): boolean {
  const aDate = filingDateByAccession.get(a.accession_number) ?? "";
  const bDate = filingDateByAccession.get(b.accession_number) ?? "";
  if (aDate !== bDate) return aDate > bDate;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.accession_number > b.accession_number;
}

/**
 * Grades one CIK from submissions metadata alone. Returns null when nothing
 * about the company suggests a blank check, so the caller can prune a row that
 * no longer qualifies.
 *
 * The ladder, and why each rung sits where it does:
 *
 * - **high** — an S-1-family registration plus either a blank-check name or
 *   EDGAR's own 6770 coding, with nothing arguing against it. A registration
 *   filed while carrying the name is a SPAC IPO by construction, and it holds
 *   up after the company de-SPACs and renames, which is exactly where a
 *   `sic = 6770` lookup fails (DraftKings today reads 7990, Lucid 3711).
 *   6770-plus-registration is admitted on the same rung: of those with no name
 *   evidence either way, 150 of the 168 registered in 2019-2024 appear in
 *   embarc's curated SPAC list (89%), matching the rest of the tier.
 * - **medium** — one signal, weakened or contradicted: a weak-class name with
 *   nothing else, or a 6770 filer that registered only *after* shedding a
 *   blank-check name.
 * - **low** — a blank-check name appears only in history *and* the registration
 *   came after the rename. That is the Form 10 shell pattern: register on
 *   10-12G, reverse-merge, then file an S-1 for the operating company's resale
 *   (CIK 1348155, R&R ACQUISITION I → Global Employment Holdings). Kept rather
 *   than dropped because the same shape occasionally *is* a SPAC whose earlier
 *   filings we have not ingested.
 *
 * A parsed registration whose latest `is_spac` is false caps the grade at
 * `low`, even when the name/SIC ladder would have said medium or high. That is
 * how an operating company that merely *looks* like a blank check (Associates
 * First Capital, Sprint Capital) leaves the process worklist without a fourth
 * confidence rung. Null means the forms pipeline has not classified a
 * registration yet, so the ladder stands. True leaves the ladder in place.
 *
 * Note what is deliberately NOT decided here: whether the as-filed SGML header
 * said 6770. That lives in the filing, not in submissions metadata, and reading
 * it is the S-1 extractor's job — worth knowing because the header is often the
 * only place the truth survives (Melar Acquisition Corp. I reads 7389 in
 * `entities` while its S-1 header says 6770), and sometimes it is absent
 * entirely (Viking Acquisition Corp I's S-1 carries no SIC line at all).
 */
export function classifySpacCandidate(
  facts: SpacCandidateFacts,
  identifiedAt: string
): SpacCandidate | null {
  const signal_sic_6770 = facts.current_sic === BLANK_CHECK_SIC;
  // The header the filing itself carried, which — unlike `entities.sic` — never
  // drifts. This is what reaches a completed de-SPAC: Joby, Opendoor, Hippo,
  // E2open, Markforged and Banzai all recoded AND renamed, so every other signal
  // is gone while their registration statements still read 6770.
  const signal_filed_sic_6770 = facts.filed_sic_6770;
  const signal_name_match = looksLikeBlankCheckName(facts.name);
  const signal_renamed_from = facts.renamed_from;
  const hasRegistration = facts.first_reg_date !== null;

  // Strong name evidence is a blank-check name on either the current or the
  // former name; a weak match (see MODERN_SPAC_NAME_PATTERNS) counts for
  // candidacy and for `medium`, but never carries `high` on its own.
  const strongName = signal_name_match || looksLikeBlankCheckName(signal_renamed_from);
  const weakName =
    looksLikeModernSpacName(facts.name) || looksLikeModernSpacName(signal_renamed_from);

  if (!signal_sic_6770 && signal_filed_sic_6770 !== true && !strongName && !weakName) return null;

  // A blank-check-shaped *name* on its own is not evidence. EDGAR is full of
  // private acquisition vehicles and dormant shells ("TRAVELPORT UK ACQUISITION
  // CORP", "SINCLAIR ACQUISITION VIII INC") that never registered securities
  // and never will. Require either a registration on file or EDGAR's own
  // blank-check coding before the company counts as a candidate at all.
  if (!hasRegistration && !signal_sic_6770 && signal_filed_sic_6770 !== true) return null;

  // Whether the earliest registration predates the loss of the blank-check
  // name. Only answerable when the company renamed away from one; a company
  // that still carries the name has, trivially, not renamed away from it yet.
  //
  // The CURRENT name is consulted first, and that order is the whole point: a
  // company still carrying a SPAC-shaped name today never renamed away from
  // one, whatever `spac_name_ended` says. Any earlier closed interval is a
  // cosmetic variant ("Corp." -> "Corp") or a pre-IPO sponsor rebrand, and
  // dating the registration against it would wrongly read as "registered after
  // shedding the name" — the Form 10 shell shape — and demote a live SPAC to
  // `low`.
  let reg_while_spac_named: boolean | null = null;
  if (hasRegistration && (signal_name_match || looksLikeModernSpacName(facts.name))) {
    // Still carrying the name today, so it has not renamed away from it.
    reg_while_spac_named = true;
  } else if (hasRegistration && facts.spac_name_ended !== null) {
    reg_while_spac_named = facts.first_reg_date! <= facts.spac_name_ended.slice(0, 10);
  }

  // `false` is the one value that argues against a SPAC: the company registered
  // only AFTER shedding its blank-check name, which is the Form 10 shell /
  // reverse-merger shape. `null` merely means there was no rename to date the
  // registration against, and is not evidence either way.
  const contradicted = reg_while_spac_named === false;

  let confidence: SpacCandidateConfidence;
  // A registration filed under a 6770 header IS a blank-check IPO by
  // construction — a stronger claim than today's current-SIC signal, which only
  // says the filer reads 6770 now — so it carries `high` on the same footing.
  if (
    hasRegistration &&
    !contradicted &&
    (strongName || signal_sic_6770 || signal_filed_sic_6770 === true)
  ) {
    confidence = "high";
  } else if (hasRegistration && (signal_sic_6770 || weakName)) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  if (facts.classified_as_spac === false) {
    confidence = "low";
  }

  return {
    cik: facts.cik,
    name: facts.name,
    current_sic: facts.current_sic,
    signal_sic_6770,
    signal_filed_sic_6770,
    signal_name_match,
    signal_renamed_from,
    first_reg_form: facts.first_reg_form,
    first_reg_date: facts.first_reg_date,
    reg_while_spac_named,
    confidence,
    identified_at: identifiedAt,
  };
}
