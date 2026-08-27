/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The heading vocabulary the HTML parser and the form segmenters share.
 *
 * The `S1` in the names is historical: the list has since grown the
 * merger-proxy (DEFM14A/PREM14A) sections and is no longer S-1-only. It lives
 * beside the parser because `joinSplitHeadings`, `coverPage` and `DePaginator`
 * all consult it while building the document tree, before any form-specific
 * code runs.
 */

/** Canonical section names this spec extracts. */
export const S1_SECTIONS = {
  MANAGEMENT: "Management",
  BENEFICIAL_OWNERSHIP: "Principal and Selling Stockholders",
  RELATED_PARTY: "Certain Relationships and Related Transactions",
  THE_OFFERING: "The Offering",
  UNDERWRITING: "Underwriting",
  USE_OF_PROCEEDS: "Use of Proceeds",
  THE_SPONSOR: "The Sponsor",
  EXECUTIVE_COMPENSATION: "Executive Compensation",
  RISK_FACTORS: "Risk Factors",
  // Item 12's resale block, where the lock-up terms are stated. Filers who omit
  // the Item 12 heading state the underwriter lock-up in Underwriting instead,
  // which is why the lock-up extractor falls back to that section's text.
  LOCK_UP: "Shares Eligible for Future Sale",
  // SPAC business/summary prose feeding the profile extractor (focus, focus
  // location, description, website).
  PROSPECTUS_SUMMARY: "Prospectus Summary",
  // Merger-proxy (DEFM14A/PREM14A) sections; read by the merger-proxy extractor.
  THE_MERGER: "The Merger",
  BUSINESS_COMBINATION: "The Business Combination",
  PIPE_FINANCING: "PIPE Financing",
} as const;
export type S1SectionName = (typeof S1_SECTIONS)[keyof typeof S1_SECTIONS];

/** Accepted heading variants per canonical section (matched against a whole line). */
export const SECTION_HEADING_PATTERNS: Readonly<Record<S1SectionName, readonly RegExp[]>> = {
  [S1_SECTIONS.MANAGEMENT]: [
    /^\s*management\s*$/i,
    /^\s*(our\s+)?management\s*$/i,
    /^\s*executive officers(,| and)? (and )?directors\s*$/i,
    /^\s*directors and executive officers\s*$/i,
    // The Item 401 heading a smaller reporting company uses, which adds the
    // "promoters and control persons" clause the larger form omits. It is the
    // same roster, and without it a shell registrant's S-1 yields no people.
    /^\s*directors,? (and )?executive officers,? promoters and control persons\s*$/i,
    // Item 6 of Form 20-F, which is the vocabulary a foreign private issuer's
    // F-1 uses. The "S-1" extractor registers F-1 among its forms, so the
    // registry routes it here, and `SPAC_REGISTRATION_FORMS` lists it ("many
    // SPACs are Cayman"), but the heading list was domestic-only, so an F-1
    // yielded no roster at all. The conjunction stands alone as well as
    // qualifying a word — `Fusion Fuel Green PLC` heads its roster `DIRECTORS
    // AND MANAGEMENT`, which an alternation of only " senior" / " and
    // executive" does not reach.
    /^\s*(board of )?directors,?( senior| and( executive)?)? management( and employees)?\s*$/i,
    // SPAC prospectuses often brand this section rather than titling it
    // "Management" — Constellation Acquisition I's 2021 S-1 heads it "Our Team"
    // (anchored `<A NAME="OurTeam">`, followed by the officers-and-directors
    // roster). Whole-line matches, so body prose mentioning "our team" cannot
    // trigger them, and the segmenter already prefers the occurrence with the
    // most body when a heading repeats in the summary.
    /^\s*our team\s*$/i,
    /^\s*(our\s+)?management team\s*$/i,
    // Same FINRA-style conflicts qualifier the underwriting heading already
    // accepts. Live 2134856 Karman Line heads the roster
    // `Management — Conflicts of Interest` (em dash or glued em dash).
    /^\s*(our\s+)?management\s*(\(conflicts of interest\)|[-–—:]\s*conflicts of interest)\s*$/i,
    // Karman's actual SectionNode title. The conflicts qualifier above is a
    // cross-ref spelling; the converter emits `MANAGEMENT AND ADVISORS`.
    /^\s*(our\s+)?management and advisors?\s*$/i,
  ],
  [S1_SECTIONS.BENEFICIAL_OWNERSHIP]: [
    /^\s*principal (and selling )?stockholders\s*$/i,
    /^\s*principal (and selling )?shareholders\s*$/i,
    /^\s*security ownership[^\n]*\s*$/i,
    /^\s*beneficial ownership[^\n]*\s*$/i,
    // Item 7 of Form 20-F — the foreign private issuer's spelling of the same
    // table. The optional tail is the combined Item 7 heading, whose body
    // carries the ownership table first.
    /^\s*major (share|stock)holders( and related party transactions)?\s*$/i,
  ],
  [S1_SECTIONS.RELATED_PARTY]: [
    // "Related Person Transactions" is the modern SEC Item 404 wording and is
    // common in real filings alongside the older "Related Party Transactions".
    /^\s*certain relationships and related (party |person |persons )?transactions\s*$/i,
    /^\s*related (part(y|ies)|persons?) transactions\s*$/i,
    /^\s*transactions with related persons\s*$/i,
    // The older, shorter SPAC spelling of the same Item 404 heading. Measured
    // across a 62-filing sample it appears in 3 and is the filing's only Item
    // 404 section in every one, so its absence dropped the disclosure outright.
    /^\s*certain transactions\s*$/i,
  ],
  [S1_SECTIONS.THE_OFFERING]: [
    /^\s*the offering\s*$/i,
    /^\s*our offering\s*$/i,
    // An F-1 heads its offering block "Summary Terms of The Offering".
    /^\s*summary (of )?(the )?(terms of (the )?)?offering\s*$/i,
    // Pyrophyte Acquisition Corp. II 424B4: the offering table sits under
    // "Terms of Our Offering", not "The Offering".
    /^\s*terms of (our|the) offering\s*$/i,
  ],
  [S1_SECTIONS.UNDERWRITING]: [
    /^\s*underwriting\s*$/i,
    // The FINRA Rule 5121 qualifier, which filers punctuate as a parenthetical
    // or as a dash clause. `TPG Pace Beneficial Finance Corp.` heads it
    // `UNDERWRITING—CONFLICTS OF INTEREST` with an em dash and no spaces, and
    // the parenthesized form alone lost the whole underwriter list.
    /^\s*underwriting\s*(\(conflicts of interest\)|[-–—:]\s*conflicts of interest)\s*$/i,
    /^\s*plan of distribution\s*$/i,
  ],
  [S1_SECTIONS.USE_OF_PROCEEDS]: [/^\s*use of proceeds\s*$/i],
  // SPAC-specific; intentionally tight to avoid matching sponsor mentions in body text.
  [S1_SECTIONS.THE_SPONSOR]: [
    /^\s*(the|our) sponsor\s*$/i,
    /^\s*the sponsor and its affiliates\s*$/i,
  ],
  // Item 402 compensation disclosure — the heading the Summary Compensation
  // Table sits under. A standalone "Director Compensation" heading is
  // deliberately NOT matched: that is the separate Item 402(r) director table,
  // whose rows are directors rather than named executive officers. Filings that
  // fold both into one heading ("Executive and Director Compensation") are
  // matched, because the named-executive table is inside.
  [S1_SECTIONS.EXECUTIVE_COMPENSATION]: [
    /^\s*(our\s+)?executive compensation( and other information)?\s*$/i,
    /^\s*(executive|officer)s?( officers?)? and directors? compensation\s*$/i,
    /^\s*directors? and executive (officers? )?compensation\s*$/i,
    /^\s*compensation of (our )?(directors and )?executive officers( and directors)?\s*$/i,
    /^\s*(management|executive officer) compensation\s*$/i,
    /^\s*summary compensation table\s*$/i,
  ],
  // The Item 105 risk-factor disclosure. The filer's own "Summary of Risk
  // Factors" bullet list is accepted as a variant of the same canonical section:
  // it enumerates the SAME risk captions in compressed form, and the segmenter
  // keeps the longest body per name, so a filing carrying both still extracts
  // from the full section and one carrying only the summary degrades to it
  // rather than to nothing.
  [S1_SECTIONS.RISK_FACTORS]: [
    /^\s*risk factors\s*$/i,
    /^\s*item\s*1a\.?\s*[-–—.]?\s*risk factors\s*$/i,
    /^\s*certain risk factors\s*$/i,
    /^\s*summary of risk factors\s*$/i,
  ],
  // Measured over the 42 committed S-1 fixtures: 14 carry an Item 12 "Shares
  // Eligible for Future Sale" heading and 32 disclose a lock-up somewhere, so a
  // dedicated heading is worth having AND cannot be the only way in. The
  // "Lock-Up Agreements" variants are the sub-heading filers use when they fold
  // the terms into Underwriting rather than giving them an Item 12 section.
  [S1_SECTIONS.LOCK_UP]: [
    // One alternation, not two patterns: the bare "Shares Eligible for Future
    // Sale" spelling this list used to state separately is already one of the
    // branches here, so the separate pattern was a dead alternative.
    /^\s*(securities|shares|ordinary shares) eligible for future sale\s*$/i,
    /^\s*lock-?up agreements?\s*$/i,
    /^\s*lock-?up\s*$/i,
  ],
  // Whole-line anchoring keeps these from matching "Summary Financial Data",
  // "Summary of the Offering", etc.; the segmenter keeps the longest-body
  // occurrence so a TOC stub loses to the real section.
  [S1_SECTIONS.PROSPECTUS_SUMMARY]: [
    /^\s*prospectus summary\s*$/i,
    /^\s*summary\s*$/i,
    /^\s*(our|the) company\s*$/i,
    /^\s*(our |the |proposed )?business\s*$/i,
    /^\s*(our )?business strategy\s*$/i,
  ],
  [S1_SECTIONS.THE_MERGER]: [/^\s*the merger\s*$/i, /^\s*the merger agreement\s*$/i],
  [S1_SECTIONS.BUSINESS_COMBINATION]: [
    /^\s*the business combination\s*$/i,
    /^\s*the business combination agreement\s*$/i,
    /^\s*proposal no\.?\s*1[^\n]*business combination\s*$/i,
  ],
  [S1_SECTIONS.PIPE_FINANCING]: [
    /^\s*pipe (financing|investment|subscription)\s*$/i,
    /^\s*the pipe\s*$/i,
  ],
};
