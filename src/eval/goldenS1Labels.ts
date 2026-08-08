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
 * A related-party row. Same single scored field as {@link O}, kept separate
 * because the two answer different questions and their judgement calls differ:
 * an ownership row must be in the table, while a related party is whoever the
 * prose names as a counterparty.
 */
const R = (name: string): GoldenOwnerRow => ({ name });

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

  // ── related-party ──────────────────────────────────────────────────────────
  // FIVE of the sixteen sections name no related party at all and are labelled
  // `[]`. Those empty labels are the most valuable rows here: 1848507's section
  // contains only "our sponsor", "our independent director nominees" and "an
  // advisor to the company", and a production run over that filing wrote
  // "Independent Director Nominees" and "Advisor To The Company" into
  // `canonical_person` as if they were people. A role phrase is not a name, and
  // an empty label is what makes emitting one cost precision.
  [goldenLabelKey("s1_1507957_000143774926010088", "related-party")]: [],
  [goldenLabelKey("s1_1606242_000121390026054471", "related-party")]: [
    R("Heroix VR (Shanghai) Co., Ltd."),
    R("Hero Entertainment"),
    R("Ugo de Charette"),
    R("Jan Goetgeluk"),
    R("Mieke Criel"),
  ],
  [goldenLabelKey("s1_1822912_000121390021001475", "related-party")]: [],
  [goldenLabelKey("s1_1848507_000119312521066104", "related-party")]: [],
  [goldenLabelKey("s1_1849470_000110465921035696", "related-party")]: [],
  [goldenLabelKey("s1_1880613_000162828026005423", "related-party")]: [
    R("DDM"),
    R("DDH LLC"),
  ],
  [goldenLabelKey("s1_1918102_000110465926016226", "related-party")]: [
    R("Mark Tompkins"),
    R("Ian Jacobs"),
    R("8VC Fund V, L.P."),
    R("8VC Entrepreneurs Fund V, L.P."),
    R("EE Holdings Limited"),
  ],
  [goldenLabelKey("s1_2049662_000110465926079324", "related-party")]: [
    R("Stellantis Ventures B.V."),
    R("Stellantis Europe"),
    R("FCA US LLC"),
    R("Michael Bly"),
    R("Mercedes-Benz Corporate Investments LLC"),
    R("Mercedes-Benz"),
    R("Uwe Keller"),
    R("GVP Climate Series SVP LP - Series 3"),
    R("GVP Climate Fund I LP"),
    R("Gatemore Storage Partners II, LLC"),
    R("Gatemore Special Opportunities Master Fund Ltd"),
    R("Gatemore Storage Partners, LLC"),
    R("Gatemore Storage Partners III, LLC"),
    R("Liad Meidar"),
    R("Hermitage Investment Fund 1 LP"),
    R("Dr. Alex Yu"),
    R("Dr. Siyu Huang"),
    R("Joseph Taylor"),
    R("Ali Bouzarif"),
    R("Kevin Gold"),
    R("Sanford Litvack"),
    R("CGC III Sponsor DirectorCo LLC"),
    R("Cantor"),
  ],
  [goldenLabelKey("s1_2075109_000121390026073335", "related-party")]: [
    R("Mark Tompkins"),
    R("Ian Jacobs"),
    R("Michael Paul Tompkins"),
    R("5G Ventures S.A."),
    R("Cerracap Growth Fund I LP"),
    R("CerraCap II, LP"),
    R("Olympic Investments Inc."),
    R("AE Industrial HorizonX Venture Fund I, LP."),
    R("Die Schweizerische Post AG"),
    R("Ioannis Mendrinos"),
    R("Jason Secore"),
    R("Saurabh Ranjan"),
    R("Andreas Raptopoulos"),
    R("Emmanuel Raptopoulos"),
  ],
  [goldenLabelKey("s1_2105318_000149315226031978", "related-party")]: [
    R("EBC"),
  ],
  [goldenLabelKey("s1_2114227_000121390026039320", "related-party")]: [
    R("M. Klein Associates Inc."),
  ],
  [goldenLabelKey("s1_2134856_000182912626007847", "related-party")]: [
    R("Michael Leitner"),
    R("Keith Masback"),
    R("Beth Michelson"),
    R("Vikas Mittal"),
    R("ArgoSat Consulting LLC"),
    R("Richard C. Davis"),
    R("Dr. Graeme Shaw"),
  ],
  [goldenLabelKey("s1_2135163_000182912626006553", "related-party")]: [],
  [goldenLabelKey("s1_2136360_000213636026000003", "related-party")]: [
    R("Lucid"),
  ],
  [goldenLabelKey("s1_2147219_000110465926092088", "related-party")]: [
    R("Chardan"),
  ],
  [goldenLabelKey("s1_95572_000121390026086369", "related-party")]: [
    R("Ron Pickett"),
    R("Stephen Sadle"),
    R("H. James Magnuson"),
    R("Robert P. Crabb"),
    R("Arthur P. Dammarell"),
    R("Marshall Pickett"),
    R("Mossadaq Chughtai"),
    R("Livian L. Jones"),
    R("Troy A. Hering"),
    R("Millard L. Wallen, III"),
    R("WYCLIFFE TRINITY LLC"),
    R("Ox Hill Realty LLC"),
    R("Cashmere Holdings, LLC"),
    R("Nosha, LLC"),
    R("TG Legacy, LLC"),
  ],

  // ── use-of-proceeds ────────────────────────────────────────────────────────
  // Four filings name no use at all (resale registrations where the issuer
  // receives nothing, plus the commodity trust) and are labelled `[]`.
  //
  // For the SPACs, BOTH tables are labelled: the offering-expense table AND the
  // second table that decomposes its "Not held in trust account" line. The
  // parent line and its children therefore both appear, at different
  // granularities. That is deliberate — each is a "stated purpose" with a stated
  // amount, which is exactly what the extractor is asked for — but it is the
  // most likely place a faithful model disagrees, so it is called out here
  // rather than left for someone to rediscover from a score.
  //
  // Excluded everywhere: `Gross proceeds` (a source, not a use), `Total`
  // subtotals, and per-share metrics like "Amount held in trust per share".
  [goldenLabelKey("s1_1507957_000143774926010088", "use-of-proceeds")]: [],
  [goldenLabelKey("s1_1606242_000121390026054471", "use-of-proceeds")]: [],
  [goldenLabelKey("s1_1817004_000149315226027137", "use-of-proceeds")]: [],
  [goldenLabelKey("s1_1822912_000121390021001475", "use-of-proceeds")]: [
    { purpose: "Underwriting commissions (2% of gross proceeds from units offered to public, excluding deferred portion)", amount: 4000000 },
    { purpose: "Legal fees and expenses", amount: 250000 },
    { purpose: "Accounting fees and expenses", amount: 37500 },
    { purpose: "SEC/FINRA Expenses", amount: 65000 },
    { purpose: "Travel and road show", amount: 25000 },
    { purpose: "Nasdaq listing and filing fees (including deferred fees)", amount: 75000 },
    { purpose: "Director and Officer liability insurance premiums", amount: 400000 },
    { purpose: "Printing and engraving expenses", amount: 40000 },
    { purpose: "Miscellaneous", amount: 107500 },
    { purpose: "Held in trust account", amount: 200000000 },
    { purpose: "Not held in trust account", amount: 1000000 },
    { purpose: "Legal, accounting, due diligence, travel, and other expenses in connection with any business combination", amount: 515000 },
    { purpose: "Legal and accounting fees related to regulatory reporting obligations", amount: 50000 },
    { purpose: "Nasdaq Continued Listing Fees", amount: 75000 },
    { purpose: "Payment for office space, utilities and secretarial and administrative support", amount: 240000 },
    { purpose: "Working capital to cover miscellaneous expenses", amount: 120000 },
  ],
  [goldenLabelKey("s1_1848507_000119312521066104", "use-of-proceeds")]: [
    { purpose: "Underwriting commissions (2% of gross proceeds from units offered to public, excluding deferred portion)", amount: 7000000 },
    { purpose: "Legal fees and expenses", amount: 350000 },
    { purpose: "Printing and engraving expenses", amount: 40000 },
    { purpose: "Accounting fees and expenses", amount: 80000 },
    { purpose: "SEC/FINRA Expenses", amount: 104788 },
    { purpose: "Travel and road show", amount: 5000 },
    { purpose: "NYSE listing and filing fees", amount: 85000 },
    { purpose: "Director and Officer liability insurance premiums", amount: 800000 },
    { purpose: "Miscellaneous", amount: 10212 },
    { purpose: "Held in trust account", amount: 350000000 },
    { purpose: "Not held in trust account after offering expenses", amount: 525000 },
  ],
  [goldenLabelKey("s1_1849470_000110465921035696", "use-of-proceeds")]: [
    { purpose: "Underwriting commissions (2.0% of gross proceeds from firm units offered to public)", amount: 4500000 },
    { purpose: "Legal fees and expenses", amount: 250000 },
    { purpose: "Printing and engraving expenses", amount: 40000 },
    { purpose: "Accounting fees and expenses", amount: 45000 },
    { purpose: "SEC fees", amount: 28230 },
    { purpose: "FINRA fees", amount: 39313 },
    { purpose: "Nasdaq Capital Market Listing Fees", amount: 75000 },
    { purpose: "Travel and roadshow", amount: 20000 },
    { purpose: "D&O Insurance", amount: 650000 },
    { purpose: "Miscellaneous expenses", amount: 52457 },
    { purpose: "Held in trust account", amount: 225000000 },
    { purpose: "Held outside trust account", amount: 1300000 },
    { purpose: "Legal, accounting, due diligence, travel, consulting and other expenses in connection with any business combination", amount: 850000 },
    { purpose: "Legal and accounting fees relating to SEC reporting obligations", amount: 200000 },
    { purpose: "Reserve for liquidation expenses", amount: 100000 },
    { purpose: "Nasdaq continued listing fees", amount: 75000 },
    { purpose: "Working capital to cover miscellaneous expenses", amount: 75000 },
  ],
  [goldenLabelKey("s1_1853138_000162828026039200", "use-of-proceeds")]: [
    { purpose: "Working capital", amount: null },
    { purpose: "General corporate purposes", amount: null },
  ],
  [goldenLabelKey("s1_1880613_000162828026005423", "use-of-proceeds")]: [
    { purpose: "Reduce outstanding debt", amount: null },
    { purpose: "General corporate purposes", amount: null },
    { purpose: "Working capital", amount: null },
  ],
  [goldenLabelKey("s1_1918102_000110465926016226", "use-of-proceeds")]: [
    { purpose: "General working capital and corporate purposes", amount: null },
    { purpose: "Engineering, research and development of our first pilot nuclear reactor and related technologies", amount: null },
  ],
  [goldenLabelKey("s1_2030954_000149315226027129", "use-of-proceeds")]: [
    { purpose: "General working capital and corporate purposes", amount: null },
    { purpose: "Repayment of indebtedness", amount: null },
  ],
  [goldenLabelKey("s1_2049662_000110465926079324", "use-of-proceeds")]: [
    { purpose: "General corporate purposes", amount: null },
  ],
  [goldenLabelKey("s1_2075109_000121390026073335", "use-of-proceeds")]: [
    { purpose: "General working capital and corporate purposes", amount: null },
    { purpose: "Research and development and commercial deployment of our M3 drone platform", amount: null },
    { purpose: "Expansion of our active drone fleet and related ground infrastructure", amount: null },
    { purpose: "Geographic expansion into additional domestic and international markets", amount: null },
    { purpose: "Investments in software, autonomy and systems required to scale our operations", amount: null },
  ],
  [goldenLabelKey("s1_2087989_000143774926019444", "use-of-proceeds")]: [],
  [goldenLabelKey("s1_2105318_000149315226031978", "use-of-proceeds")]: [
    { purpose: "Underwriting commissions (2.0% of gross proceeds from units offered to public)", amount: 1500000 },
    { purpose: "Legal fees and expenses", amount: 300000 },
    { purpose: "Accounting fees and expenses", amount: 90000 },
    { purpose: "SEC/FINRA Expenses", amount: 50000 },
    { purpose: "Nasdaq listing and filing fees (includes deferred amount)", amount: 80000 },
    { purpose: "Printing and engraving expenses", amount: 25000 },
    { purpose: "Miscellaneous", amount: 180000 },
    { purpose: "Held in trust account", amount: 75187500 },
    { purpose: "Not held in trust account", amount: 600000 },
    { purpose: "Legal, accounting, due diligence, travel, and other expenses in connection with any business combination", amount: 155000 },
    { purpose: "Legal and accounting fees related to regulatory reporting obligations", amount: 125000 },
    { purpose: "Payment for office space, administrative and support services", amount: 100000 },
    { purpose: "Nasdaq continued listing fees", amount: 70000 },
    { purpose: "Working capital to cover miscellaneous expenses, including general corporate purposes and reserves (including D&O insurance)", amount: 150000 },
  ],
  [goldenLabelKey("s1_2114227_000121390026039320", "use-of-proceeds")]: [
    { purpose: "Underwriting discounts and commissions (excluding deferred portion)", amount: 4500000 },
    { purpose: "Legal fees and expenses", amount: 325000 },
    { purpose: "Printing and engraving expenses", amount: 35000 },
    { purpose: "Accounting and bookkeeping fees and expenses", amount: 40000 },
    { purpose: "SEC/FINRA expenses", amount: 119359 },
    { purpose: "Nasdaq listing and filing fees", amount: 85000 },
    { purpose: "Travel and roadshow expenses", amount: 10000 },
    { purpose: "Miscellaneous", amount: 385641 },
    { purpose: "Held in trust account", amount: 300000000 },
    { purpose: "Not held in trust account", amount: 1000000 },
    { purpose: "Legal, accounting, due diligence, travel and other expenses in connection with business combination", amount: 100000 },
    { purpose: "Legal and accounting fees related to regulatory reporting obligations", amount: 100000 },
    { purpose: "Reimbursement for office space and administrative support", amount: 360000 },
    { purpose: "Consulting, travel and miscellaneous expenses incurred during search for initial business combination target", amount: 100000 },
    { purpose: "Director and Officer liability insurance premiums", amount: 300000 },
    { purpose: "Working capital to cover miscellaneous expenses", amount: 40000 },
  ],
  [goldenLabelKey("s1_2133239_000192998026000317", "use-of-proceeds")]: [
    { purpose: "Non-contingent underwriting discount (0.7% of gross proceeds from offering)", amount: 700000 },
    { purpose: "Reimbursement for underwriter expenses", amount: 110000 },
    { purpose: "Legal fees and expenses", amount: 279000 },
    { purpose: "NASDAQ listing fee", amount: 75000 },
    { purpose: "SEC registration fee", amount: 20000 },
    { purpose: "FINRA filing fee", amount: 22000 },
    { purpose: "Printing and engraving expenses", amount: 25000 },
    { purpose: "Bookkeeper fees", amount: 24000 },
    { purpose: "Accounting fees and expenses", amount: 97000 },
    { purpose: "Transfer agent fees", amount: 30000 },
    { purpose: "Miscellaneous expenses", amount: 71000 },
    { purpose: "Held in trust", amount: 100000000 },
    { purpose: "Not held in trust", amount: 500000 },
    { purpose: "D&O Insurance", amount: 100000 },
    { purpose: "Legal, accounting, due diligence, travel and other expenses in connection with any business combination", amount: 230000 },
    { purpose: "Legal and accounting fees relating to SEC reporting obligations", amount: 70000 },
    { purpose: "Working capital", amount: 100000 },
  ],
  [goldenLabelKey("s1_2134856_000182912626007847", "use-of-proceeds")]: [
    { purpose: "Underwriting discount (2.0% of gross proceeds from units offered to public, excluding the deferred portion)", amount: 4000000 },
    { purpose: "Legal fees and expenses", amount: 200000 },
    { purpose: "Nasdaq listing fee", amount: 85000 },
    { purpose: "Printing and engraving expenses", amount: 35000 },
    { purpose: "Accounting fees and expenses", amount: 75000 },
    { purpose: "FINRA filing fee", amount: 35000 },
    { purpose: "SEC registration fee", amount: 55460 },
    { purpose: "Trustee fees and expenses", amount: 40000 },
    { purpose: "Miscellaneous expenses", amount: 251216 },
    { purpose: "Held in the trust account from this offering", amount: 200000000 },
    { purpose: "Not held in the trust account from this offering", amount: 1723324 },
    { purpose: "Legal, accounting and other third-party expenses related to business combination", amount: 300000 },
    { purpose: "SEC filing and other legal and accounting fees related to regulatory reporting obligations", amount: 150000 },
    { purpose: "Office space and other administrative expenses ($20,000 per month for up to 24 months)", amount: 480000 },
    { purpose: "D&O insurance", amount: 150000 },
    { purpose: "Nasdaq and other regulatory fees", amount: 85000 },
    { purpose: "Consulting fee", amount: 240000 },
    { purpose: "Working capital to cover miscellaneous expense and general corporate purposes", amount: 318324 },
  ],
  [goldenLabelKey("s1_2135163_000182912626006553", "use-of-proceeds")]: [
    { purpose: "Underwriting discounts (0.50% of gross proceeds from offering)", amount: 500000 },
    { purpose: "Legal fees and expenses", amount: 375000 },
    { purpose: "NYSE listing fee", amount: 85000 },
    { purpose: "Printing and engraving expenses", amount: 30000 },
    { purpose: "Accounting fees and expenses", amount: 60000 },
    { purpose: "SEC & FINRA registration fees", amount: 28960 },
    { purpose: "Underwriter expenses reimbursement", amount: 35000 },
    { purpose: "Miscellaneous expenses", amount: 86040 },
    { purpose: "Held in the trust account", amount: 100000000 },
    { purpose: "Not held in the trust account", amount: 1000000 },
    { purpose: "Legal, accounting and other third-party expenses attendant to the search for target businesses and to the due diligence investigation, structuring and negotiation of our initial business combination", amount: 435000 },
    { purpose: "Legal and accounting fees relating to SEC reporting obligations", amount: 80000 },
    { purpose: "Due diligence, identification and research of prospective target business and reimbursement of out of pocket due diligence expenses to management", amount: 70000 },
    { purpose: "Director and officer (D&O) insurance premiums", amount: 175000 },
    { purpose: "Payment of administrative fee to the Sponsor", amount: 240000 },
  ],
  [goldenLabelKey("s1_2136360_000213636026000003", "use-of-proceeds")]: [
    { purpose: "Underwriting commissions (2.0% of gross proceeds from units offered to public)", amount: 4000000 },
    { purpose: "Legal fees and expenses", amount: 300000 },
    { purpose: "Nasdaq listing fees", amount: 85000 },
    { purpose: "Printing and engraving expenses", amount: 40000 },
    { purpose: "Accounting fees and expenses", amount: 50000 },
    { purpose: "Road show", amount: 20000 },
    { purpose: "SEC/FINRA expenses", amount: 88000 },
    { purpose: "Miscellaneous", amount: 67000 },
    { purpose: "Held in trust account", amount: 200000000 },
    { purpose: "Not held in trust account", amount: 1000000 },
    { purpose: "Legal, accounting, due diligence, travel, and other expenses in connection with any business combination", amount: 200000 },
    { purpose: "NASDAQ continued listing fees", amount: 80000 },
    { purpose: "Legal and accounting fees related to regulatory reporting obligations", amount: 100000 },
    { purpose: "Directors’ and officers’ liability insurance", amount: 200000 },
    { purpose: "Reimbursement for administrative and support services and mailing address fees", amount: 96000 },
    { purpose: "Working capital to cover miscellaneous expenses", amount: 324000 },
  ],
  [goldenLabelKey("s1_2147219_000110465926092088", "use-of-proceeds")]: [
    { purpose: "Underwriting commissions (0.5% of gross proceeds from units offered to public, excluding deferred portion)", amount: 375000 },
    { purpose: "Reimbursement of underwriters’ expenses", amount: 150000 },
    { purpose: "Payment to qualified independent underwriter", amount: 75000 },
    { purpose: "Legal fees and expenses", amount: 180000 },
    { purpose: "Printing and engraving expenses", amount: 25000 },
    { purpose: "Accounting fees and expenses", amount: 110000 },
    { purpose: "SEC/FINRA Expenses", amount: 45000 },
    { purpose: "Trustee Fees and Expenses", amount: 35000 },
    { purpose: "Nasdaq listing and filing fees", amount: 80000 },
    { purpose: "Miscellaneous", amount: 118750 },
    { purpose: "Held in trust account", amount: null },
    { purpose: "Not held in trust account", amount: 750000 },
    { purpose: "Legal, accounting, due diligence, travel, and other expenses in connection with any business combination", amount: 250000 },
    { purpose: "Legal and accounting fees related to regulatory reporting obligations", amount: 150000 },
    { purpose: "Directors’ and officers’ liability insurance", amount: 250000 },
    { purpose: "Working capital to cover miscellaneous expenses and reserves", amount: 100000 },
  ],
  [goldenLabelKey("s1_95572_000121390026086369", "use-of-proceeds")]: [
    { purpose: "To fund structural design services for the HTR facility, including the design of the building structure required for permitting", amount: 5500000 },
    { purpose: "To fund engineering services for the HTR facility, including the design and integration of the facility’s systems required for permitting", amount: 3500000 },
    { purpose: "Initial site selection costs", amount: 2500000 },
    { purpose: "To satisfy the Promissory Note", amount: 3000000 },
  ],

  // ── underwriters ───────────────────────────────────────────────────────────
  // NINE of twenty-one are `[]`: a resale "Plan of Distribution" names no
  // syndicate, only boilerplate that a reselling broker-dealer "may be deemed to
  // be an underwriter". Those are the false-positive traps, and they include two
  // deliberate lures — a selling stockholder the text calls a statutory
  // underwriter (1880613), and an ETF Authorized Participant (2087989). Neither
  // is a syndicate underwriter, so neither is a row.
  //
  // Every named row is `lead`: each of these offerings has a representative or
  // sole book-running manager, and no filing in the corpus names a co-manager.
  // 2147219's second row is a FINRA Rule 5121 qualified independent underwriter
  // — a real underwriter role but not a syndicate rank, so it takes the
  // catch-all. Only the abbreviated "B. Riley" is printed, so both name fields
  // carry it.
  [goldenLabelKey("s1_1507957_000143774926010088", "underwriters")]: [],
  [goldenLabelKey("s1_1606242_000121390026054471", "underwriters")]: [],
  [goldenLabelKey("s1_1817004_000149315226027137", "underwriters")]: [],
  [goldenLabelKey("s1_1822912_000121390021001475", "underwriters")]: [
    { legal_name: "Cantor Fitzgerald & Co.", common_name: "Cantor Fitzgerald", role: "lead" },
  ],
  [goldenLabelKey("s1_1848507_000119312521066104", "underwriters")]: [
    { legal_name: "Credit Suisse Securities (USA) LLC", common_name: "Credit Suisse", role: "lead" },
    { legal_name: "BofA Securities, Inc.", common_name: "BofA Securities", role: "lead" },
    { legal_name: "Moelis & Company LLC", common_name: "Moelis & Company", role: "lead" },
  ],
  [goldenLabelKey("s1_1849470_000110465921035696", "underwriters")]: [
    { legal_name: "Barclays Capital Inc.", common_name: "Barclays", role: "lead" },
    { legal_name: "Cantor Fitzgerald & Co.", common_name: "Cantor Fitzgerald", role: "lead" },
  ],
  [goldenLabelKey("s1_1853138_000162828026039200", "underwriters")]: [],
  [goldenLabelKey("s1_1880613_000162828026005423", "underwriters")]: [],
  [goldenLabelKey("s1_1918102_000110465926016226", "underwriters")]: [],
  [goldenLabelKey("s1_2030954_000149315226027129", "underwriters")]: [
    { legal_name: "WestPark Capital, Inc.", common_name: "WestPark Capital", role: "lead" },
  ],
  [goldenLabelKey("s1_2049662_000110465926079324", "underwriters")]: [],
  [goldenLabelKey("s1_2075109_000121390026073335", "underwriters")]: [],
  [goldenLabelKey("s1_2087989_000143774926019444", "underwriters")]: [],
  [goldenLabelKey("s1_2105318_000149315226031978", "underwriters")]: [
    { legal_name: "EarlyBirdCapital, Inc.", common_name: "EarlyBirdCapital", role: "lead" },
  ],
  [goldenLabelKey("s1_2114227_000121390026039320", "underwriters")]: [
    { legal_name: "Citigroup Global Markets Inc.", common_name: "Citigroup", role: "lead" },
  ],
  [goldenLabelKey("s1_2133239_000192998026000317", "underwriters")]: [
    { legal_name: "D. Boral Capital LLC", common_name: "D. Boral Capital", role: "lead" },
  ],
  [goldenLabelKey("s1_2134856_000182912626007847", "underwriters")]: [
    { legal_name: "Cohen & Company Securities, LLC", common_name: "Cohen & Company Capital Markets", role: "lead" },
  ],
  [goldenLabelKey("s1_2135163_000182912626006553", "underwriters")]: [
    { legal_name: "Polaris Advisory Partners, a division of Kingswood Capital LLC", common_name: "Polaris Advisory Partners", role: "lead" },
  ],
  [goldenLabelKey("s1_2136360_000213636026000003", "underwriters")]: [
    { legal_name: "Lucid Capital Markets LLC", common_name: "Lucid Capital Markets", role: "lead" },
  ],
  [goldenLabelKey("s1_2147219_000110465926092088", "underwriters")]: [
    { legal_name: "Chardan Capital Markets LLC", common_name: "Chardan", role: "lead" },
    { legal_name: "B. Riley", common_name: "B. Riley", role: "underwriter" },
  ],
  [goldenLabelKey("s1_95572_000121390026086369", "underwriters")]: [
    { legal_name: "R.F. Lafferty & Co., Inc.", common_name: "R.F. Lafferty", role: "lead" },
  ],

  // ── offering-terms ─────────────────────────────────────────────────────────
  // All four scored fields are SPAC/unit concepts, so the ten operating
  // companies carry a row of four nulls rather than no row: the section IS an
  // offering section, it simply states none of these terms. An all-null row
  // asserts "nothing to find here", which is what makes a hallucinated trust
  // figure cost accuracy — and 95572 is a live trap, a filing whose section says
  // "trust", "Baskets" and "net asset value" throughout while being a commodity
  // trust with no SPAC trust account.
  //
  // `right_fraction_per_unit` is rights PER UNIT, not shares per right. Three
  // filings bundle one whole right into each unit while stating that the right
  // converts into a fraction of a share ("one-fourth (1/4) of one ordinary
  // share"); those are 1, not 0.25.
  //
  // "one-third" is written 0.3333. No filing states the decimal, so this is the
  // one field where an equally faithful model can mismatch on precision alone.
  [goldenLabelKey("s1_1507957_000143774926010088", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_1817004_000149315226027137", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_1822912_000121390021001475", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.5, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_1848507_000119312521066104", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.25, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_1849470_000110465921035696", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.3333, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_1853138_000162828026039200", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_1880613_000162828026005423", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_1918102_000110465926016226", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_2030954_000149315226027129", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_2049662_000110465926079324", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_2075109_000121390026073335", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_2087989_000143774926019444", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],
  [goldenLabelKey("s1_2105318_000149315226031978", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.5, right_fraction_per_unit: 1, trust_per_unit: 10.025 },
  ],
  [goldenLabelKey("s1_2114227_000121390026039320", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.1, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_2133239_000192998026000317", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 1, right_fraction_per_unit: 1, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_2134856_000182912626007847", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.3333, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_2135163_000182912626006553", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 1, right_fraction_per_unit: 1, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_2136360_000213636026000003", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.3333, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_2147219_000110465926092088", "offering-terms")]: [
    { price_per_unit: 10.0, warrant_fraction_per_unit: 0.25, right_fraction_per_unit: null, trust_per_unit: 10.0 },
  ],
  [goldenLabelKey("s1_95572_000121390026086369", "offering-terms")]: [
    { price_per_unit: null, warrant_fraction_per_unit: null, right_fraction_per_unit: null, trust_per_unit: null },
  ],

  // ── executive-compensation ─────────────────────────────────────────────────
  // Rows align POSITIONALLY (no keyField), so order is part of the label: an
  // officer shown for two fiscal years is two rows, top-to-bottom as printed.
  //
  // EIGHT SPACs are `[]` — each states outright that no officer has received any
  // cash compensation and prints no table. Those are the strongest negatives in
  // the corpus: the Summary Compensation Table gate should decline to send the
  // section to a model at all, and an empty label is what proves it.
  //
  // Two filings carry null salary/total for every row. That is NOT a
  // transcription gap: 1853138 and 1880613 hit the collapsed-colspan converter
  // defect, and their dollar columns do not survive into the text the extractor
  // is handed. The label describes what the section actually contains, so a
  // model that invents figures there is wrong, and one that returns null is
  // right — which is the only way the defect stays visible instead of being
  // quietly absorbed as a model error.
  [goldenLabelKey("s1_1507957_000143774926010088", "executive-compensation")]: [
    { person_name: "David Somo", fiscal_year: 2025, salary: 57212, total: 2160767 },
    { person_name: "Timothy Burns", fiscal_year: 2025, salary: 282576, total: 494788 },
    { person_name: "Timothy Burns", fiscal_year: 2024, salary: 282576, total: 669293 },
    { person_name: "R. Daniel Brdar", fiscal_year: 2025, salary: 306519, total: 678216 },
    { person_name: "R. Daniel Brdar", fiscal_year: 2024, salary: 354200, total: 1180139 },
  ],
  [goldenLabelKey("s1_1606242_000121390026054471", "executive-compensation")]: [
    { person_name: "Jan Goetgeluk", fiscal_year: 2026, salary: 306657, total: 447982 },
    { person_name: "Jan Goetgeluk", fiscal_year: 2025, salary: 250000, total: 250000 },
    { person_name: "David Allan", fiscal_year: 2026, salary: 326944, total: 1069444 },
    { person_name: "David Allan", fiscal_year: 2025, salary: 300000, total: 1420500 },
    { person_name: "Lauren Premo", fiscal_year: 2026, salary: 223440, total: 416540 },
    { person_name: "Lauren Premo", fiscal_year: 2025, salary: 200292, total: 232097 },
  ],
  [goldenLabelKey("s1_1822912_000121390021001475", "executive-compensation")]: [],
  [goldenLabelKey("s1_1848507_000119312521066104", "executive-compensation")]: [],
  [goldenLabelKey("s1_1849470_000110465921035696", "executive-compensation")]: [],
  [goldenLabelKey("s1_1853138_000162828026039200", "executive-compensation")]: [
    { person_name: "Don Burnette", fiscal_year: 2025, salary: null, total: null },
    { person_name: "Don Burnette", fiscal_year: 2024, salary: null, total: null },
    { person_name: "Surajit Datta", fiscal_year: 2025, salary: null, total: null },
    { person_name: "Surajit Datta", fiscal_year: 2024, salary: null, total: null },
    { person_name: "Michael Wiesinger", fiscal_year: 2025, salary: null, total: null },
    { person_name: "Michael Wiesinger", fiscal_year: 2024, salary: null, total: null },
  ],
  [goldenLabelKey("s1_1880613_000162828026005423", "executive-compensation")]: [
    { person_name: "Mark Walker", fiscal_year: 2025, salary: 500000, total: null },
    { person_name: "Mark Walker", fiscal_year: 2024, salary: 500000, total: null },
    { person_name: "Keith Smith", fiscal_year: 2025, salary: 500000, total: null },
    { person_name: "Keith Smith", fiscal_year: 2024, salary: 500000, total: null },
    { person_name: "Diana P. Diaz", fiscal_year: 2025, salary: 350000, total: null },
    { person_name: "Diana P. Diaz", fiscal_year: 2024, salary: 350000, total: null },
  ],
  [goldenLabelKey("s1_1918102_000110465926016226", "executive-compensation")]: [
    { person_name: "Elizabeth Muller", fiscal_year: 2025, salary: 404261, total: 7018912 },
    { person_name: "Elizabeth Muller", fiscal_year: 2024, salary: 400000, total: 541005 },
    { person_name: "Richard Muller, Ph.D.", fiscal_year: 2025, salary: 300000, total: 1679635 },
    { person_name: "Richard Muller, Ph.D.", fiscal_year: 2024, salary: 300000, total: 549068 },
    { person_name: "Michael Brasel", fiscal_year: 2025, salary: 242898, total: 660346 },
    { person_name: "Malcolm Thompson", fiscal_year: 2025, salary: 160417, total: 3663221 },
    { person_name: "Malcolm Thompson", fiscal_year: 2024, salary: 250000, total: 328050 },
    { person_name: "Ian Jacobs", fiscal_year: 2024, salary: null, total: null },
  ],
  [goldenLabelKey("s1_2049662_000110465926079324", "executive-compensation")]: [
    { person_name: "Siyu Huang, Ph.D., MBA", fiscal_year: 2025, salary: 200000, total: 1688189 },
    { person_name: "Alex Yu, Ph.D.", fiscal_year: 2025, salary: 262500, total: 1172102 },
    { person_name: "Jason Duva", fiscal_year: 2025, salary: 251244, total: 1097718 },
  ],
  [goldenLabelKey("s1_2075109_000121390026073335", "executive-compensation")]: [
    { person_name: "Andreas Raptopoulos", fiscal_year: 2025, salary: 224000, total: null },
    { person_name: "Jason Secore", fiscal_year: 2025, salary: 220000, total: null },
    { person_name: "Alexander Norman-Elvenich", fiscal_year: 2025, salary: 192356, total: null },
    { person_name: "Ian Jacobs", fiscal_year: 2025, salary: null, total: null },
  ],
  [goldenLabelKey("s1_2105318_000149315226031978", "executive-compensation")]: [],
  [goldenLabelKey("s1_2114227_000121390026039320", "executive-compensation")]: [],
  [goldenLabelKey("s1_2133239_000192998026000317", "executive-compensation")]: [],
  [goldenLabelKey("s1_2135163_000182912626006553", "executive-compensation")]: [],
  [goldenLabelKey("s1_2147219_000110465926092088", "executive-compensation")]: [],
  [goldenLabelKey("s1_95572_000121390026086369", "executive-compensation")]: [
    { person_name: "Ronald W. Pickett", fiscal_year: 2025, salary: 200000, total: 200000 },
    { person_name: "Ronald W. Pickett", fiscal_year: 2024, salary: 200000, total: 200000 },
    { person_name: "Stephen L. Sadle", fiscal_year: 2025, salary: 175000, total: 175000 },
    { person_name: "Stephen L. Sadle", fiscal_year: 2024, salary: 175000, total: 175000 },
    { person_name: "Mil L. (Flip) Wallen", fiscal_year: 2025, salary: null, total: 1125000 },
    { person_name: "Mil L. (Flip) Wallen", fiscal_year: 2024, salary: null, total: null },
  ],

  // ── sponsor-promote ────────────────────────────────────────────────────────
  // Founder-share counts are the GROSS, pre-forfeiture number the sponsor
  // actually acquired, not the post-offering figure net of shares subject to
  // forfeiture. Both appear in every one of these filings and they always
  // differ, so this is the field most likely to disagree; the promote is what
  // was bought, and the forfeiture is a contingency on top of it.
  //
  // `founder_percent` is only ever the stated percentage. Every SPAC here states
  // one, so none is null on this ground — but `private_placement_warrants` IS
  // null for 2133239 and 2135163, where the sponsor buys private UNITS and the
  // warrant count inside them is never printed. Deriving it needs subtraction,
  // and the extractor is explicitly told not to compute.
  //
  // The non-SPACs are `[]` — NO row, not a row of nulls. `extractSponsorPromote`
  // returns null when there is no promote, and an all-null row scored a correct
  // "nothing here" as a miss. Three are post-de-SPAC resale
  // registrations (1853138, 2049662, 2075109) that name a "Sponsor", founder
  // shares and private warrants belonging to the PREDECESSOR shell — the
  // sharpest false-positive trap in the corpus, since every keyword is present
  // and none of it is a promote being created by this offering. Two of the three
  // do trip it, reporting the legacy shell's 14,300,000 / 6,800,000 private
  // warrants as this offering's promote; `[]` is what makes that cost precision.
  [goldenLabelKey("s1_1507957_000143774926010088", "sponsor-promote")]: [],
  [goldenLabelKey("s1_1817004_000149315226027137", "sponsor-promote")]: [],
  [goldenLabelKey("s1_1822912_000121390021001475", "sponsor-promote")]: [
    { founder_shares: 5750000, founder_percent: 0.2, private_placement_warrants: 6000000, public_warrant_coverage: 0.5, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_1848507_000119312521066104", "sponsor-promote")]: [
    { founder_shares: 5366667, founder_percent: 0.1, private_placement_warrants: 6000000, public_warrant_coverage: 0.25, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_1849470_000110465921035696", "sponsor-promote")]: [
    { founder_shares: 6643750, founder_percent: 0.2, private_placement_warrants: 233333, public_warrant_coverage: 0.3333, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_1853138_000162828026039200", "sponsor-promote")]: [],
  [goldenLabelKey("s1_1880613_000162828026005423", "sponsor-promote")]: [],
  [goldenLabelKey("s1_1918102_000110465926016226", "sponsor-promote")]: [],
  [goldenLabelKey("s1_2030954_000149315226027129", "sponsor-promote")]: [],
  [goldenLabelKey("s1_2049662_000110465926079324", "sponsor-promote")]: [],
  [goldenLabelKey("s1_2075109_000121390026073335", "sponsor-promote")]: [],
  [goldenLabelKey("s1_2087989_000143774926019444", "sponsor-promote")]: [],
  [goldenLabelKey("s1_2105318_000149315226031978", "sponsor-promote")]: [
    { founder_shares: 2875000, founder_percent: 0.25, private_placement_warrants: 150625, public_warrant_coverage: 0.5, trust_per_public_share: 10.025 },
  ],
  [goldenLabelKey("s1_2114227_000121390026039320", "sponsor-promote")]: [
    { founder_shares: 11500000, founder_percent: 0.25, private_placement_warrants: 35000, public_warrant_coverage: 0.1, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_2133239_000192998026000317", "sponsor-promote")]: [
    { founder_shares: 2875000, founder_percent: 0.2, private_placement_warrants: null, public_warrant_coverage: 1.0, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_2134856_000182912626007847", "sponsor-promote")]: [
    { founder_shares: 7666667, founder_percent: 0.25, private_placement_warrants: 216667, public_warrant_coverage: 0.3333, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_2135163_000182912626006553", "sponsor-promote")]: [
    { founder_shares: 4933500, founder_percent: 0.3, private_placement_warrants: null, public_warrant_coverage: 1.0, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_2136360_000213636026000003", "sponsor-promote")]: [
    { founder_shares: 7666667, founder_percent: 0.25, private_placement_warrants: 188333, public_warrant_coverage: 0.3333, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_2147219_000110465926092088", "sponsor-promote")]: [
    { founder_shares: 2156250, founder_percent: 0.2, private_placement_warrants: 48593, public_warrant_coverage: 0.25, trust_per_public_share: 10.0 },
  ],
  [goldenLabelKey("s1_95572_000121390026086369", "sponsor-promote")]: [],

  // ── spac-profile ───────────────────────────────────────────────────────────
  // SPACs ONLY — `Form_S_1.storage` gates this extractor behind `isSpac`, so an
  // operating company's summary is never fed to it and labelling one would
  // invent ground truth for an input the pipeline cannot produce. The coverage
  // guard knows this (see SPAC_ONLY_EXTRACTORS).
  //
  // FOUR of the ten are `focus: []`. That is the correct answer, not a gap: a
  // generalist SPAC states outright that its search "will not be limited to a
  // particular industry", and Churchill XII goes further by naming its focus as
  // its team's expertise rather than any sector. An empty array is what makes an
  // invented sector cost accuracy, and it is the single most likely thing for a
  // model to hallucinate here — every one of these summaries spends pages on the
  // sponsors' industry backgrounds, which is NOT the acquisition focus.
  //
  // Two mappings are lossy because the vocabulary has no entry: space/aerospace
  // infrastructure (2134856) is carried as Aviation + Defense, and mining and
  // minerals (2136360) as Materials + Natural Resources. Both are the closest
  // available, and both are places a reasonable model may answer differently.
  [goldenLabelKey("s1_1822912_000121390021001475", "spac-profile")]: [
    { focus: ["Gaming", "Consumer", "Hospitality", "Entertainment", "E-commerce"], focus_location: [] },
  ],
  [goldenLabelKey("s1_1848507_000119312521066104", "spac-profile")]: [
    { focus: ["Financial Services", "Technology", "Software", "Data & Analytics", "Asset Management"], focus_location: [] },
  ],
  [goldenLabelKey("s1_1849470_000110465921035696", "spac-profile")]: [
    { focus: ["Technology", "PropTech", "FinTech"], focus_location: [] },
  ],
  [goldenLabelKey("s1_2105318_000149315226031978", "spac-profile")]: [
    { focus: [], focus_location: ["Asia"] },
  ],
  [goldenLabelKey("s1_2114227_000121390026039320", "spac-profile")]: [
    { focus: [], focus_location: [] },
  ],
  [goldenLabelKey("s1_2133239_000192998026000317", "spac-profile")]: [
    { focus: [], focus_location: ["China"] },
  ],
  [goldenLabelKey("s1_2134856_000182912626007847", "spac-profile")]: [
    { focus: ["Aviation", "Defense", "Telecommunications", "Internet of Things", "Artificial Intelligence", "Data & Analytics"], focus_location: [] },
  ],
  [goldenLabelKey("s1_2135163_000182912626006553", "spac-profile")]: [
    { focus: [], focus_location: [] },
  ],
  [goldenLabelKey("s1_2136360_000213636026000003", "spac-profile")]: [
    { focus: ["Materials", "Natural Resources"], focus_location: ["United States", "Canada", "Australia", "United Kingdom", "Latin America"] },
  ],
  [goldenLabelKey("s1_2147219_000110465926092088", "spac-profile")]: [
    { focus: ["Healthcare", "Biopharmaceuticals"], focus_location: [] },
  ],

  // ── spac-sponsors ──────────────────────────────────────────────────────────
  // Only one filing in the corpus resolves a "The Sponsor" section. It is the
  // Texas Precious Metals Trust — a commodity trust, not a SPAC — whose sponsor
  // is a fund manager rather than a blank-check promoter. That is exactly why it
  // is worth labelling: the extractor should read the sponsor a section names,
  // not assume the SPAC shape its own name implies.
  [goldenLabelKey("s1_2087989_000143774926019444", "spac-sponsors")]: [
    { legal_name: "Teucrium Asset Management, LLC", common_name: "Teucrium Asset Management" },
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
