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

/**
 * Any other extractor's row, as a bag of scored fields.
 *
 * The scorer never sees these declared shapes: `EvalS1Task` passes golden rows
 * straight through as `Record<string, unknown>` and compares only the
 * `compareFields` its {@link EVAL_EXTRACTORS} entry names. So a per-extractor
 * interface would buy no additional safety at the point that matters — what
 * actually protects a label is the guard in goldenS1Labels.test.ts asserting
 * every row carries exactly that extractor's compareFields, which catches a
 * misspelled or missing key that a structural type could not (`compareFields`
 * is data, not a type).
 *
 * Management and ownership keep named interfaces because they are written by
 * hand constantly and their helpers (`G`, `O`) are worth the types.
 */
export type GoldenFieldRow = Readonly<Record<string, unknown>>;

export type GoldenRow = GoldenManagementRow | GoldenOwnerRow | GoldenFieldRow;

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
 * The one and only positive `spac-classification` row. The extractor narrows
 * `entity_kind` to the literal "spac" before returning, so a positive verdict
 * has exactly one shape and every SPAC's label is identical — writing it once
 * keeps twenty labels from drifting apart character by character.
 */
const SPAC: GoldenFieldRow = { is_spac: true, entity_kind: "spac" };

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
  // Gold Mountain Acquisition Corp. Its table prints "Independent Director
  // Nominee", labelled here as "Director Nominee" to match the rest of the
  // corpus: independence is a separate determination about a director, not a
  // distinct board role, and 1848507 prints "Independent Director Nominees" as a
  // category label while its rows are labelled "Director Nominee". The roster
  // heading is "Officers, Directors and Director Nominees", not "Management".
  [goldenLabelKey("s1_2105318_000149315226031978", "management")]: [
    G("Sanxin Yan", ["Chairman of the Board of Directors"]),
    G("Yong (David) Yan", ["Chief Executive Officer", "Chief Financial Officer", "Director"]),
    G("Brian Hartzband", ["Director Nominee"]),
    G("Joel Mayersohn", ["Director Nominee"]),
    G("Qiang Zhang", ["Director Nominee"]),
  ],
  // Southern Cross Acquisition II Corp. — self-filed SPAC.
  [goldenLabelKey("s1_2133239_000192998026000317", "management")]: [
    // "Chairwoman, Director and Chief Executive Officer" as printed; the bare
    // "Director" is absorbed by the board-seat role during normalization.
    G("Ally Tong Zhang", ["Chairwoman of the Board of Directors", "Chief Executive Officer"]),
    G("Xin Wang", ["Chief Financial Officer"]),
    G("Hongmei Zhao", ["Director"]),
    G("Wenhua Qian", ["Director"]),
    G("Zhiqiang Du", ["Director"]),
  ],
  // Albatross Acquisition Corp — one seated officer holding four roles at once,
  // plus three independent director nominees.
  [goldenLabelKey("s1_2135163_000182912626006553", "management")]: [
    G("Zihan Chen", [
      "Chairman of the Board of Directors",
      "Chief Executive Officer",
      "Chief Financial Officer",
    ]),
    G("Ping Zhang", ["Director Nominee"]),
    G("Becky Fallon", ["Director Nominee"]),
    G("Daniel M. McCabe", ["Director Nominee"]),
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
  // Gold Mountain. Excludes the "All executive officers, directors and director
  // nominees as a group (6 individuals)" subtotal. Four individuals hold nothing
  // (all-dash) and Qiang Zhang's cells are blank entirely — both still get rows,
  // since an officer is listed precisely to disclose that they hold none.
  [goldenLabelKey("s1_2105318_000149315226031978", "beneficial-ownership")]: [
    O("Gaea Holding Group Limited"),
    O("Gold Mountain Holding LP"),
    O("Sanxin Yan"),
    // Kept as the table prints it. The parenthesized nickname is part of the
    // name, not an annotation like "(our sponsor)(3)": it is folded into
    // `middle` downstream and so is identity-bearing, which is what separates
    // two people sharing a common given name and surname.
    O("Yong (David) Yan"),
    O("Brian Hartzband"),
    O("Joel Mayersohn"),
    O("Qiang Zhang"),
    O("EarlyBirdCapital, Inc."),
  ],
  // Southern Cross II. This table carries TWO printed category labels —
  // "Principal Shareholders (5% or more)" and "Directors and Executive
  // Officers" — neither of which is an owner, plus the usual group subtotal.
  [goldenLabelKey("s1_2133239_000192998026000317", "beneficial-ownership")]: [
    O("Southern Cross Acquisition II Sponsor Corp."),
    O("Peizhong Yu"),
    O("Ally Tong Zhang"),
    O("Xin Wang"),
    O("Hongmei Zhao"),
    O("Zhiqiang Du"),
    O("Wenhua Qian"),
  ],
  // Albatross. Two cells carry inline role annotations — "Albatross Peak Limited
  // (our Sponsor)" and "Zihan Chen (CEO)" — dropped like any parenthetical.
  [goldenLabelKey("s1_2135163_000182912626006553", "beneficial-ownership")]: [
    O("Albatross Peak Limited"),
    O("Zihan Chen"),
    O("Becky Fallon"),
    O("Daniel M. McCabe"),
    O("Ping Zhang"),
  ],
  // Material Resource. The only fixture whose MANAGEMENT section the segmenter
  // fails to resolve at all, so this ownership table is the sole place its five
  // officers/nominees are labelled — see the KNOWN DEFECT note in
  // parseEdgarHtml.golden.test.ts.
  [goldenLabelKey("s1_2136360_000213636026000003", "beneficial-ownership")]: [
    O("Material Resource Acquisition Sponsor LLC"),
    O("Rick Bloom"),
    O("Brian Kaufman"),
    O("Jim Berklas"),
    O("Brian Klemsz"),
    O("David Linsley"),
  ],
  // ── Operating companies: management + ownership ────────────────────────────
  // Virtuix Holdings — two roster tables ("Executive Officers", then
  // "Non-Employee Directors"); both are the roster.
  [goldenLabelKey("s1_1606242_000121390026054471", "management")]: [
    G("Jan Goetgeluk", ["Chief Executive Officer", "Chairman of the Board of Directors"]),
    G("Thomas McGinnis", ["Chief Financial Officer"]),
    G("David Allan", ["Chief Operating Officer", "President", "Director"]),
    G("Lauren Premo", ["Chief Marketing Officer"]),
    G("Cameron Slayter", ["Chief Product Officer"]),
    G("Ugo de Charette", ["Director"]),
    G("John Cunningham", ["Director"]),
    G("Parthkumar Jani", ["Director"]),
    G("Brett Moyer", ["Director"]),
    G("Randolph Read", ["Director"]),
  ],
  // Goetgeluk and de Charette are each printed TWICE — once under "Executive
  // Officers and Directors" and again under "5% Stockholders", same figures.
  // Labelled once: `name` is the extractor's dedupe key, so a second row would
  // be scored as a duplicate the model is right not to produce.
  [goldenLabelKey("s1_1606242_000121390026054471", "beneficial-ownership")]: [
    O("Jan Goetgeluk"),
    O("David Allan"),
    O("Parthkumar Jani"),
    O("Ugo de Charette"),
    O("Randolph Read"),
    O("John Cunningham"),
    O("Thomas McGinnis"),
    O("Lauren Premo"),
    O("Brett Moyer"),
    O("Cameron Slayter"),
    O("Streeterville Capital, LLC"),
  ],
  // Kodiak AI. KNOWN CONVERTER DEFECT: this roster's colspan cells collapse, so
  // the rendered table is the name repeated nine times with NO age or position
  // column — every title here is read from the bios instead. James Reed is
  // chair per "Our Board consists of seven members, with James Reed serving as
  // Chair" — "Chair of the Board of Directors", NOT "Chairman": the normalizer
  // expands the board phrase but keeps the registrant's own word, and writing
  // "Chairman" here invented a gendered form the filing never uses. The bare
  // chair title absorbs his bare "Director" on normalization.
  [goldenLabelKey("s1_1853138_000162828026039200", "management")]: [
    G("Don Burnette", ["Chief Executive Officer", "Director"]),
    G("Surajit Datta", ["Chief Financial Officer"]),
    G("Jordan Coleman", ["Chief Legal and Policy Officer"]),
    G("Zsuzsanna Major", ["Chief People Officer"]),
    G("Andreas Wendel", ["Chief Technology Officer"]),
    G("Michael Wiesinger", ["Chief Operating Officer"]),
    G("Mohamed Elshenawy", ["Director"]),
    G("Kenneth Goldman", ["Director"]),
    G("James Reed", ["Chair of the Board of Directors"]),
    G("Allyson Satin", ["Director"]),
    G("Kristin Sverchek", ["Director"]),
    G("Scott Tobin", ["Director"]),
  ],
  // Direct Digital Holdings. Same collapsed-colspan roster as Kodiak, so titles
  // come from the bios.
  //
  // Keith W. Smith is "President" only. This filing's OWNERSHIP table prints
  // "Keith Smith, President and Director", and an earlier draft of this label
  // used that to add "Director" — but the management extractor is handed the
  // management section alone and cannot see that table. A golden label has to be
  // derivable from the section it scores, or it marks a faithful reader wrong
  // for not knowing something it was never shown.
  [goldenLabelKey("s1_1880613_000162828026005423", "management")]: [
    G("Mark D. Walker", ["Chairman of the Board of Directors", "Chief Executive Officer"]),
    G("Keith W. Smith", ["President"]),
    G("Diana P. Diaz", ["Chief Financial Officer"]),
    G("Anu Pillai", ["Chief Technology Officer"]),
    G("Maria Vilchez Lowrey", ["Chief Growth Officer"]),
    G("Richard Cohen", ["Director"]),
    G("Antoinette R. Leatherberry", ["Director"]),
    G("Mistelle Locke", ["Director"]),
  ],
  [goldenLabelKey("s1_1880613_000162828026005423", "beneficial-ownership")]: [
    O("Direct Digital Management, LLC"),
    O("Mark Walker"),
    O("Keith Smith"),
    O("Diana P. Diaz"),
    O("Richard Cohen"),
    O("Antoinette R. Leatherberry"),
    O("Mistelle Locke"),
  ],
  // Deep Fission. "Chair of the Board" canonicalizes to "Chair of the Board of
  // Directors" — the normalizer expands the board phrase without rewriting the
  // registrant's chosen gender-neutral form. Class designations ("(Class III)")
  // are term-stagger labels, not roles, and are dropped.
  [goldenLabelKey("s1_1918102_000110465926016226", "management")]: [
    G("Elizabeth Muller", [
      "Chair of the Board of Directors",
      "President",
      "Chief Executive Officer",
    ]),
    G("Richard A. Muller", ["Chief Technology Officer"]),
    G("William (Mark) Schmitz", ["Chief Financial Officer"]),
    G("Michael Brasel", ["Chief Operating Officer"]),
    G("Jon Gordon", ["General Counsel", "Secretary"]),
    G("Blake Janover", ["Director"]),
    G("Leslie Goldman Tepper", ["Director"]),
    G("Jonathon Angell", ["Director"]),
    G("Thomas Glanville", ["Director"]),
  ],
  // Names are transcribed as EACH table prints them, which is why several
  // disagree with the roster above ("Jonathan"/"Jonathon" Angell, "Richard
  // Muller"/"Richard A. Muller"). The filing is inconsistent with itself; the
  // label follows the section the extractor is actually reading.
  [goldenLabelKey("s1_1918102_000110465926016226", "beneficial-ownership")]: [
    O("Entities affiliated with 8VC"),
    O("Mark Tompkins"),
    O("EE Holdings Limited"),
    O("Jonathan Angell"),
    O("Michael Brasel"),
    O("Thomas S. Glanville"),
    O("Blake Janover"),
    O("Elizabeth Muller"),
    O("Richard Muller"),
    O("Leslie Goldman Tepper"),
  ],
  // Factorial Energy. "Executive Chairperson" is NOT expanded: the normalizer
  // only expands a BARE chair title, and the modifier is part of the role the
  // filing gave him. "Co-founder" canonicalizes to "Co-Founder".
  [goldenLabelKey("s1_2049662_000110465926079324", "management")]: [
    G("Siyu Huang, Ph.D.", ["Co-Founder", "Chief Executive Officer", "Director"]),
    G("Alex Yu, Ph.D.", ["Co-Founder", "Chief Technology Officer", "Director"]),
    G("Richard Wei", ["Chief Financial Officer"]),
    G("Jason Duva", ["General Counsel", "Secretary", "Head of Government Affairs"]),
    G("Joseph M. Taylor", ["Executive Chairperson"]),
    G("Uwe Keller", ["Director"]),
    G("Liad Meidar", ["Director"]),
    G("Dieter Zetsche", ["Director"]),
    G("Jon Nelson", ["Director"]),
  ],
  // The final data row prints "Sponsor, DirectorCo and Pangaea Three-B, LP" —
  // three owners in one cell, so three rows. "Sponsor" and "DirectorCo" are the
  // filing's own defined shorthands; it never prints the Sponsor's legal name
  // in this section, so the shorthand is what the table actually shows.
  [goldenLabelKey("s1_2049662_000110465926079324", "beneficial-ownership")]: [
    O("Siyu Huang"),
    O("Alex Yu"),
    O("Jason Duva"),
    O("Joseph Taylor"),
    O("Uwe Keller"),
    O("Liad Meidar"),
    O("Dieter Zetsche"),
    O("Jon Nelson"),
    O("WAVE Equity Fund, L.P."),
    O("Mercedes-Benz Corporate Investments LLC"),
    O("Stellantis Europe S.p.A"),
    O("Sponsor"),
    O("DirectorCo"),
    O("Pangaea Three-B, LP"),
  ],
  [goldenLabelKey("s1_2075109_000121390026073335", "management")]: [
    G("Andreas Raptopoulos", ["Director", "Chief Executive Officer"]),
    G("Jason Secore", ["Chief Financial Officer"]),
    G("Alexander Norman-Elvenich", ["Chief Operating Officer"]),
    G("Chris Dawson", ["Director"]),
    G("Sanjay Kotte", ["Director"]),
    G("Laurence J. Marton, M.D.", ["Director"]),
    G("Saurabh Ranjan", ["Director"]),
  ],
  // "Sanjay Kottee" here vs "Sanjay Kotte" in the roster above — a typo in the
  // filing, kept because the label must match the section being scored.
  [goldenLabelKey("s1_2075109_000121390026073335", "beneficial-ownership")]: [
    O("Andreas Raptopoulos"),
    O("Mark Tompkins"),
    O("5G Ventures S.A."),
    O("Entities affiliated with CerraCap"),
    O("Alexander Norman-Elvenich"),
    O("Jason Secore"),
    O("Ian Jacobs"),
    O("Chris Dawson"),
    O("Sanjay Kottee"),
    O("Laurence J. Marton, M.D."),
    O("Saurabh Ranjan"),
  ],
  // Karman Line. The sponsor is "Samara Acquisition Sponsor VI Ltd." — this
  // shell was drafted from a Samara template and mentions "Samara" more often
  // than "Karman"; the registrant on the cover is Karman Line Acquisition Corp.
  [goldenLabelKey("s1_2134856_000182912626007847", "beneficial-ownership")]: [
    O("Samara Acquisition Sponsor VI Ltd."),
    O("Richard Davis"),
    O("Graeme Shaw"),
    O("Vikas Mittal"),
    O("Michael Leitner"),
    O("Keith Masback"),
    O("Beth Michelson"),
  ],

  // ── spac-classification ────────────────────────────────────────────────────
  // The only extractor whose truth needs no transcription: it is decided by who
  // the issuer is. `extractSpacClassification` returns null unless
  // `is_spac === true` AND `entity_kind === "spac"`, so a non-SPAC's correct
  // answer is NO ROW — and an empty label is what makes a false positive cost
  // precision. That is the whole point of balancing the corpus 10/11: a
  // detector that has never been scored against a real operating company has
  // not been shown to reject one.
  // 26 Capital Acquisition Corp.
  [goldenLabelKey("s1_1822912_000121390021001475", "spac-classification")]: [SPAC],
  // 1.12 Acquisition Corp
  [goldenLabelKey("s1_1848507_000119312521066104", "spac-classification")]: [SPAC],
  // 1Sharpe Acquisition Corp.
  [goldenLabelKey("s1_1849470_000110465921035696", "spac-classification")]: [SPAC],
  // Gold Mountain Acquisition Corp.
  [goldenLabelKey("s1_2105318_000149315226031978", "spac-classification")]: [SPAC],
  // Churchill Capital Corp XII
  [goldenLabelKey("s1_2114227_000121390026039320", "spac-classification")]: [SPAC],
  // Southern Cross Acquisition II Corp.
  [goldenLabelKey("s1_2133239_000192998026000317", "spac-classification")]: [SPAC],
  // Karman Line Acquisition Corp.
  [goldenLabelKey("s1_2134856_000182912626007847", "spac-classification")]: [SPAC],
  // Albatross Acquisition Corp
  [goldenLabelKey("s1_2135163_000182912626006553", "spac-classification")]: [SPAC],
  // Material Resource Acquisition Corp.
  [goldenLabelKey("s1_2136360_000213636026000003", "spac-classification")]: [SPAC],
  // Rainier Acquisition Corp
  [goldenLabelKey("s1_2147219_000110465926092088", "spac-classification")]: [SPAC],

  // Operating companies — the negative cases. `[]` is the assertion: emitting
  // any row here is a false positive.
  // Ideal Power Inc. — power semiconductors (SIC 3674)
  [goldenLabelKey("s1_1507957_000143774926010088", "spac-classification")]: [],
  // Virtuix Holdings Inc. — VR hardware (SIC 3577)
  [goldenLabelKey("s1_1606242_000121390026054471", "spac-classification")]: [],
  // NEXTNRG, INC. — mobile fuel delivery (SIC 5500)
  [goldenLabelKey("s1_1817004_000149315226027137", "spac-classification")]: [],
  // Kodiak AI, Inc. — autonomous trucking (SIC 7373)
  [goldenLabelKey("s1_1853138_000162828026039200", "spac-classification")]: [],
  // Direct Digital Holdings, Inc. — advertising (SIC 7310)
  [goldenLabelKey("s1_1880613_000162828026005423", "spac-classification")]: [],
  // Deep Fission, Inc. — modular reactors (SIC 4911)
  [goldenLabelKey("s1_1918102_000110465926016226", "spac-classification")]: [],
  // TEN Holdings, Inc. — services (SIC 7389)
  [goldenLabelKey("s1_2030954_000149315226027129", "spac-classification")]: [],
  // Factorial Energy Inc. — batteries (SIC 3690)
  [goldenLabelKey("s1_2049662_000110465926079324", "spac-classification")]: [],
  // Matternet, Inc. — drone logistics (SIC 3721)
  [goldenLabelKey("s1_2075109_000121390026073335", "spac-classification")]: [],
  // Texas Precious Metals Trust — commodity trust (SIC 6221)
  [goldenLabelKey("s1_2087989_000143774926019444", "spac-classification")]: [],
  // KiNRG, Inc. — mining (SIC 1040)
  [goldenLabelKey("s1_95572_000121390026086369", "spac-classification")]: [],

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
