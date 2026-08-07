/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Human-verified "truth" for the committed real S-1 sections, used by
 * `sec eval s1 --reference golden`. A live reference model (even the strongest
 * one) is not ground truth — it drops or invents the odd role — which caps achievable
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
 *
 * Labels are transcribed from the committed filing text and cross-checked
 * against independent model reads; where the two disagreed the filing wins, and
 * the reasoning is recorded inline (see Haldeman below). They are committed so a
 * reviewer can check them against the source — that review, not their authorship,
 * is what makes them truth.
 */
/** A `management` roster entry, keyed by `full_name` and scored on name + titles. */
export interface GoldenManagementRow {
  readonly full_name: string;
  readonly titles: readonly string[];
}

/**
 * A `beneficial-ownership` table entry. Only `name` is scored — share counts and
 * percentages are formatted too variably to compare cleanly (see the
 * `beneficial-ownership` entry in EVAL_EXTRACTORS), so the measured question is
 * "does the model list the right owners".
 */
export interface GoldenOwnerRow {
  readonly name: string;
}

export type GoldenRow = GoldenManagementRow | GoldenOwnerRow;

/** Narrow a golden row to the management shape (the only one carrying titles). */
export function isGoldenManagementRow(row: GoldenRow): row is GoldenManagementRow {
  return "full_name" in row;
}

/** Key a golden entry by `${filing}::${extractor}` (filing = accession-derived basename). */
export function goldenLabelKey(filing: string, extractor: string): string {
  return `${filing}::${extractor}`;
}

const G = (full_name: string, titles: readonly string[]): GoldenManagementRow => ({
  full_name,
  titles,
});

/** A beneficial-ownership row: the owner's name as the table prints it. */
const O = (name: string): GoldenOwnerRow => ({ name });

/**
 * Committed golden labels, keyed by {@link goldenLabelKey}. Only sections that
 * appear here are scored under `--reference golden`; everything else is skipped.
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
    // Corrected from "Director" to "Director Nominee".
    //
    // The table cell — "Director and Chairman of the Board nominee" — is
    // genuinely ambiguous about whether "nominee" reaches back to "Director",
    // and this label previously resolved it by model consensus: sonnet,
    // gpt-5.4-mini and gemini all read the Director as seated. That is the one
    // way ground truth must NOT be decided; the labels are the yardstick every
    // model is measured against, so deriving them from model agreement scores
    // future candidates against whatever those models happened to share.
    //
    // The prose settles it. Four parallel sentences, identical construction:
    //   Haldeman "will serve as the chairman of our Board of Directors upon the
    //             effective date of the registration statement"
    //   Seid     "will serve as a member of our Board of Directors upon the
    //             effective date ..."   (likewise Klahr, Boyle)
    // He differs from the three acknowledged nominees only in serving as
    // chairman rather than as a member — he is not seated either. Found when
    // deepseek-v4-flash returned "Director Nominee" and was scored wrong for it.
    G("Charles E. Haldeman Jr.", [
      "Director Nominee",
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

  // Ideal Power Inc. — an operating-company IPO (the corpus's compensation-table
  // fixture). Somo's and Burns' bios add roles their table cells compress into a
  // parenthetical abbreviation; Turmelle's cell states only the chairmanship,
  // which is how the other chairs in this set are labeled.
  [goldenLabelKey("s1_1507957_000143774926010088", "management")]: [
    G("David Somo", ["President", "Chief Executive Officer", "Director"]),
    G("Timothy W. Burns", ["Chief Financial Officer", "Secretary", "Treasurer"]),
    G("Drue Freeman", ["Director"]),
    G("Gregory Knight", ["Director"]),
    G("Ted Lesster", ["Director"]),
    G("Michael C. Turmelle", ["Chairman of the Board of Directors"]),
  ],

  // Rainier Acquisition Corp — 2026 Cayman SPAC (Chardan-sponsored).
  //
  // The roster table's last row is a literal "[·]" in every column: an unnamed
  // second director nominee the filer has not yet chosen. It is a typesetting
  // placeholder, not a person, so it is NOT a roster entry — a model that emits
  // it has invented a director, which is exactly the kind of thing this label
  // exists to catch.
  //
  // Amusa and Manke are SEATED, not nominees: both bios say "has served as ...
  // since March 2026", against Lam's "will serve ... upon the effectiveness of
  // this registration statement". That is the same construction that settles
  // Haldeman above, read the other way.
  //
  // Titles drop the Exchange Act designations the cells carry in parentheses
  // ("(Principal Executive Officer)", "(Principal Financial and Accounting
  // Officer)") — those qualify a title, they are not a second one. Manke's
  // "Chairman of the Board, Director" is one canonical title, not two: the
  // normalizer folds the board seat into the chairmanship.
  [goldenLabelKey("s1_2147219_000110465926092088", "management")]: [
    G("Gbola Amusa, M.D., CFA", ["Chief Executive Officer", "Director"]),
    G("Guy Barudin", ["Chief Financial Officer"]),
    G("Isaac Manke, Ph.D.", ["Chairman of the Board of Directors"]),
    G("Jonas Grossman", ["Director"]),
    G("Andrew Lam, PharmD", ["Director Nominee"]),
  ],

  // KiNRG, Inc. — a small operating-company IPO. Every director is seated for a
  // one-year term, so unlike the SPACs there is not a nominee in the set.
  // Pickett's cell packs three roles into one string ("Chief Executive Officer,
  // Chairman and Principal Accounting Officer"); the normalizer splits it and
  // expands the bare chairmanship, and here "Principal Accounting Officer" IS a
  // held office rather than a parenthetical designation of another title.
  [goldenLabelKey("s1_95572_000121390026086369", "management")]: [
    G("Ronald W. Pickett", [
      "Chief Executive Officer",
      "Chairman of the Board of Directors",
      "Principal Accounting Officer",
    ]),
    G("Flip Wallen", ["President"]),
    G("Stephen Sadle", ["Chief Operating Officer", "Director"]),
    G("Robert P. Crabb", ["Secretary"]),
    G("H. James Magnuson", ["Director"]),
    G("Mossadaq Chughtai", ["Director"]),
    G("Troy A. Hering CPA", ["Director"]),
    G("Livian L. Jones", ["Director"]),
  ],

  // ---------------------------------------------------------------------------
  // beneficial-ownership — the stockholder rows of each table, in table order.
  //
  // Convention (mirrors the extraction prompt, enforced for the subtotal case by
  // `isOwnershipGroupSubtotal`): the trailing "All officers and directors as a
  // group (N)" subtotal is NOT an owner and is excluded; names carry no footnote
  // markers or parenthetical annotations; a cell naming two owners is TWO rows —
  // `name` holds exactly one entity, never "X and Y". Rows showing "—"/"--"/"-"
  // (no shares) are still owners and ARE listed — the table lists them, and only
  // `name` is scored.
  // ---------------------------------------------------------------------------

  // 26 Capital Acquisition Corp. — sponsor + Ader hold all founder shares.
  [goldenLabelKey("s1_1822912_000121390021001475", "beneficial-ownership")]: [
    O("26 Capital Holdings LLC"),
    O("Jason Ader"),
    O("John Lewis"),
    O("Rafi Ashkenazi"),
    O("Joseph Kaminkow"),
    O("Gregory S. Lyss"),
  ],
  // BGPT / Martire founder vehicle. "Don Layden." carries a stray trailing period
  // in the filing; the scorer strips non-decimal periods, so either form aligns.
  [goldenLabelKey("s1_1848507_000119312521066104", "beneficial-ownership")]: [
    O("BGPT 1.12 LP"),
    O("Frank R. Martire, Jr."),
    O("Frank Martire, III"),
    O("Tanmay Kumar"),
    O("Howard Chatzinoff"),
    O("Frank D’Angelo"),
    O("Rachel Landrum"),
    O("Don Layden"),
    O("Patricia A. Oelrich"),
    O("Tom Shen"),
  ],
  // 1Sharpe real-estate SPAC.
  [goldenLabelKey("s1_1849470_000110465921035696", "beneficial-ownership")]: [
    O("1Sharpe SPAC Sponsor LLC"),
    O("Gregor Watson"),
    O("Rob Bloemker"),
    O("Charles E. Haldeman, Jr."),
    O("Jacob Seid"),
    O("Suzanne Klahr"),
    O("Richard J Boyle, Jr."),
  ],
  // Operating company (not a SPAC): a 5% holder block plus zero-share officers.
  // The 5% cell reads "V-Cube, Inc. and Naoaki Mashita" — a company AND a person,
  // which is two owners, not one name. Footnote 5 attributes the shares
  // separately (1,520,000 to V-Cube, 45,942 to Mr. Mashita), so the split is
  // stated by the filing rather than synthesized. Keeping it as one row would put
  // a name that is plainly two names into `name` — and the S-1 persist path would
  // resolve it into the canonical company tier as a single bogus company.
  [goldenLabelKey("s1_2030954_000149315226027129", "beneficial-ownership")]: [
    O("Randolph Wilson Jones III"),
    O("Christina Maldonado"),
    O("Virgilio D. Torres"),
    O("Yuji Ishida"),
    O("Gan Yong Sheng"),
    O("V-Cube, Inc."),
    O("Naoaki Mashita"),
  ],
  // Ideal Power Inc. — three 5% holders above the officer/director block. "AIGH"
  // is the table's own printed name for the group footnote 2 defines; the label
  // is the cell as printed, marker dropped.
  [goldenLabelKey("s1_1507957_000143774926010088", "beneficial-ownership")]: [
    O("AWM Investment Company, Inc."),
    O("AIGH"),
    O("Laurence W. Lytton"),
    O("David Somo"),
    O("Timothy Burns"),
    O("Drue Freeman"),
    O("Gregory Knight"),
    O("Ted Lesster"),
    O("Michael C. Turmelle"),
  ],
  // Churchill Capital Corp XII. The sponsor cell prints as
  // "Churchill Sponsor XII LLC(our sponsor)(3)" — annotation and marker dropped.
  [goldenLabelKey("s1_2114227_000121390026039320", "beneficial-ownership")]: [
    O("Churchill Sponsor XII LLC"),
    O("Michael Klein"),
    O("Jay Taragin"),
    O("William Sherman"),
  ],
  // Rainier Acquisition Corp. Four of the six rows show "—" in BOTH the share
  // and percentage columns: officers and nominees who hold nothing. They are
  // still rows the table prints — the disclosure IS that they hold none — so
  // they are owners here, and a model that skips them has under-reported the
  // table. That failure was real: deepseek-v4-flash dropped exactly this shape
  // on the 2030954 table until the prompt was told to emit them.
  //
  // The sponsor cell prints "Ravenna 7 LLC (our sponsor)"; the annotation is
  // dropped like Churchill's. The trailing "All officers, directors and
  // director nominees as a group (5 individuals)" is the subtotal, excluded.
  [goldenLabelKey("s1_2147219_000110465926092088", "beneficial-ownership")]: [
    O("Ravenna 7 LLC"),
    O("Gbola Amusa, M.D., CFA"),
    O("Guy Barudin"),
    O("Isaac Manke, Ph.D."),
    O("Jonas Grossman"),
    O("Andrew Lam, PharmD"),
  ],
  // KiNRG, Inc. The table opens with a printed category label —
  // "Names Executive Officers, Executive Officers and Directors:" — occupying a
  // name cell with every figure column blank. It is a heading for the rows
  // beneath it, not an owner, and it is NOT the group subtotal either, so
  // `isOwnershipGroupSubtotal` does not reach it: dropping it is the model's
  // job. The real subtotal ("All executive officers and directors as a group
  // (8 persons)") is excluded by the usual convention.
  [goldenLabelKey("s1_95572_000121390026086369", "beneficial-ownership")]: [
    O("Ronald W. Pickett"),
    O("Flip Wallen"),
    O("Stephen Sadle"),
    O("Robert P. Crabb"),
    O("H. James Magnuson"),
    O("Mossadaq Chughtai"),
    O("Troy A. Hering CPA"),
    O("Livian L. Jones"),
  ],
};

/** Golden rows for one section, or undefined when the section is unlabeled. */
/**
 * Extractors that have at least one committed golden label.
 *
 * Derived from the labels rather than hardcoded, so adding a label set for a new
 * extractor automatically brings it into the default `--reference golden` sweep
 * — the alternative is a constant that silently drifts out of date and quietly
 * stops scoring sections somebody took the trouble to label.
 */
export function extractorsWithGoldenLabels(): string[] {
  const seen = new Set<string>();
  for (const key of Object.keys(GOLDEN_S1_LABELS)) {
    const extractor = key.split("::")[1];
    if (extractor) seen.add(extractor);
  }
  return [...seen].sort();
}

export function getGoldenLabels(
  filing: string,
  extractor: string
): readonly GoldenRow[] | undefined {
  return GOLDEN_S1_LABELS[goldenLabelKey(filing, extractor)];
}
