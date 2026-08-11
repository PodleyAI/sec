/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import { ExecutiveCompensationOutputSchema } from "../sec/forms/registration-statements/s1/executiveCompensationSchema";
import { LoiOutputSchema } from "../sec/forms/registration-statements/s1/loiSchema";
import { OfferingTermsOutputSchema } from "../sec/forms/registration-statements/s1/offeringTermsSchema";
import { RiskFactorsOutputSchema } from "../sec/forms/registration-statements/s1/riskFactorSchema";
import {
  BeneficialOwnershipOutputSchema,
  ManagementOutputSchema,
  RelatedPartyOutputSchema,
} from "../sec/forms/registration-statements/s1/sectionSchemas";
import {
  beneficialOwnershipInstructions,
  buildExtractionPrompt,
  executiveCompensationInstructions,
  extractBeneficialOwnership,
  extractExecutiveCompensation,
  extractLoi,
  extractManagement,
  extractOfferingTerms,
  extractRelatedParty,
  extractRiskFactors,
  extractSpacClassification,
  extractSpacProfile,
  extractSpacSponsors,
  extractSponsorPromote,
  extractUnderwriters,
  extractUseOfProceeds,
  loiInstructions,
  managementInstructions,
  offeringTermsInstructions,
  relatedPartyInstructions,
  riskFactorsInstructions,
  spacClassificationInstructions,
  spacProfileInstructions,
  spacSponsorsInstructions,
  sponsorPromoteInstructions,
  underwritersInstructions,
  useOfProceedsInstructions,
} from "../sec/forms/registration-statements/s1/sectionExtractors";
import { SpacClassificationOutputSchema } from "../sec/forms/registration-statements/s1/spacClassifierSchema";
import { SpacProfileOutputSchema } from "../sec/forms/registration-statements/s1/spacProfileSchema";
import { SpacSponsorOutputSchema } from "../sec/forms/registration-statements/s1/spacSponsorSchema";
import { SponsorPromoteOutputSchema } from "../sec/forms/registration-statements/s1/sponsorPromoteSchema";
import { UnderwriterOutputSchema } from "../sec/forms/registration-statements/s1/underwriterSchema";
import { UseOfProceedsOutputSchema } from "../sec/forms/registration-statements/s1/useOfProceedsSchema";

/**
 * Character length of the extraction prompt (preamble + instructions + fenced
 * section) used for eval cost estimates. Derived from the real builder so it
 * tracks instruction edits automatically — not a hand-tuned constant.
 * Uses the no-nonce shape (local providers / default estimate); a cloud nonce
 * adds a few dozen characters and does not change comparative ranking.
 */
export function estimateExtractionPromptChars(
  instructions: string,
  sectionText: string
): number {
  return buildExtractionPrompt({ instructions, sectionText }).length;
}

/**
 * A section extractor the harness can drive: it takes section prose + a model
 * and returns an array of row objects (single-object extractors wrap their one
 * result). `keyField` aligns candidate rows with a fixture's expected rows; omit
 * it for positional (single-object / order-stable) extractors.
 *
 * `context` is the running eval task's execute context, threaded so the
 * generation task each extractor spawns is `context.own`ed onto that task's
 * subgraph (inheriting its registry and abort signal) and its phase progress
 * reaches the CLI row. Omitted by direct callers (tests), which fall back to the
 * self-contained stub context inside `runStructured`.
 */
export interface EvalExtractor {
  readonly run: (text: string, model: ModelConfig, context?: IExecuteContext) => Promise<unknown[]>;
  readonly instructions: () => string;
  /** Canonical JSON Schema the extractor validates model output against. */
  readonly schema: () => object;
  readonly keyField?: string;
  /**
   * Fields that count toward the score when comparing against a reference (used
   * by the oracle eval, where the reference model's rows carry every field —
   * `confidence`, `source_span`, etc. — that we do NOT want to score on).
   * Defaults (when unset) to comparing every field of the expected row.
   */
  readonly compareFields?: readonly string[];
}

/**
 * Registry of extractors the `sec eval` harness can exercise, keyed by the name
 * a fixture (and `--extractor`) references. Extend by adding an entry and a
 * matching fixture below.
 */
export const EVAL_EXTRACTORS: Record<string, EvalExtractor> = {
  management: {
    run: (text, model, context) => extractManagement(text, model, context),
    instructions: managementInstructions,
    schema: () => ManagementOutputSchema,
    keyField: "full_name",
    compareFields: ["full_name", "titles"],
  },
  "beneficial-ownership": {
    run: (text, model, context) => extractBeneficialOwnership(text, model, context),
    instructions: beneficialOwnershipInstructions,
    schema: () => BeneficialOwnershipOutputSchema,
    keyField: "name",
    // Percentages/share counts are formatted too variably to score cleanly;
    // compare on who is listed (name) — the field the models should agree on.
    compareFields: ["name"],
  },
  // List extractor over a prospectus Item 105 section: one row per risk-factor
  // caption. Scored on the caption (verbatim) and the category heading it sits
  // under — the section's introductory prose and category headings themselves
  // must NOT produce rows, so emitting one costs precision.
  "risk-factors": {
    run: (text, model, context) => extractRiskFactors(text, model, context),
    instructions: riskFactorsInstructions,
    schema: () => RiskFactorsOutputSchema,
    keyField: "headline",
    compareFields: ["headline", "category"],
  },
  "related-party": {
    run: (text, model, context) => extractRelatedParty(text, model, context),
    instructions: relatedPartyInstructions,
    schema: () => RelatedPartyOutputSchema,
    keyField: "name",
    compareFields: ["name"],
  },
  // Single-object extractor over an S-1/424 "The Offering" section; positional
  // alignment (no keyField). Scored on the objective numeric unit terms.
  "offering-terms": {
    run: async (text, model, context) => {
      const row = await extractOfferingTerms(text, model, context);
      return row === null ? [] : [row];
    },
    instructions: offeringTermsInstructions,
    schema: () => OfferingTermsOutputSchema,
    compareFields: [
      "price_per_unit",
      "warrant_fraction_per_unit",
      "right_fraction_per_unit",
      "trust_per_unit",
    ],
  },
  // Single-object extractor over a SPAC "The Offering" / "The Sponsor" section;
  // positional alignment (no keyField). Scored on the objective promote figures.
  "sponsor-promote": {
    run: async (text, model, context) => {
      const row = await extractSponsorPromote(text, model, context);
      return row === null ? [] : [row];
    },
    instructions: sponsorPromoteInstructions,
    schema: () => SponsorPromoteOutputSchema,
    compareFields: [
      "founder_shares",
      "founder_percent",
      "private_placement_warrants",
      "public_warrant_coverage",
      "trust_per_public_share",
    ],
  },
  // Detection-style classifier over a registration filing's summary prose: a
  // true SPAC yields one row; a shell or operating company yields none, so a
  // fixture with `expected: []` scores a false positive as lost precision.
  "spac-classification": {
    run: async (text, model, context) => {
      const row = await extractSpacClassification(text, model, context);
      return row === null ? [] : [row];
    },
    instructions: spacClassificationInstructions,
    schema: () => SpacClassificationOutputSchema,
    keyField: "entity_kind",
    compareFields: ["is_spac", "entity_kind"],
  },
  // Multi-row table extractor over the Item 402 Summary Compensation Table.
  // Positionally aligned (no keyField): a table yields one row per officer PER
  // FISCAL YEAR, so no single field identifies a row, and a compensation table
  // is read top-to-bottom — the order-stable list case positional alignment is
  // for. Scored on the cells every table has, whichever disclosure regime the
  // registrant reports under.
  "executive-compensation": {
    run: (text, model, context) => extractExecutiveCompensation(text, model, context),
    instructions: executiveCompensationInstructions,
    schema: () => ExecutiveCompensationOutputSchema,
    compareFields: ["person_name", "fiscal_year", "salary", "total"],
  },
  // Multi-row extractor over the Underwriting / Plan of Distribution section.
  // Keyed on the bank's legal name — the field the persist path dedupes on, so
  // a model that repeats a syndicate member should not be rewarded for it.
  underwriters: {
    run: (text, model, context) => extractUnderwriters(text, model, context),
    instructions: underwritersInstructions,
    schema: () => UnderwriterOutputSchema,
    keyField: "legal_name",
    compareFields: ["legal_name", "common_name", "role"],
  },
  // Multi-row extractor over the Use of Proceeds section: one row per line item.
  "use-of-proceeds": {
    run: (text, model, context) => extractUseOfProceeds(text, model, context),
    instructions: useOfProceedsInstructions,
    schema: () => UseOfProceedsOutputSchema,
    keyField: "purpose",
    compareFields: ["purpose", "amount"],
  },
  // Single-object profile over a SPAC's prospectus-summary prose. Scored on the
  // controlled-vocabulary focus rather than the free-text description, which no
  // two models phrase alike.
  "spac-profile": {
    run: async (text, model, context) => {
      const row = await extractSpacProfile(text, model, context);
      return row === null ? [] : [row];
    },
    instructions: spacProfileInstructions,
    schema: () => SpacProfileOutputSchema,
    compareFields: ["focus", "focus_location"],
  },
  // Multi-row extractor naming the sponsor entities behind a blank-check issuer.
  "spac-sponsors": {
    run: (text, model, context) => extractSpacSponsors(text, model, context),
    instructions: spacSponsorsInstructions,
    schema: () => SpacSponsorOutputSchema,
    keyField: "legal_name",
    compareFields: ["legal_name", "common_name"],
  },
  // Detection-style single-object extractor over a known-SPAC 8-K narrative:
  // a non-binding letter of intent yields one row; anything else (definitive
  // agreements, vote results, LOI terminations) yields none, so a fixture with
  // `expected: []` scores a false positive as lost precision.
  loi: {
    run: async (text, model, context) => {
      const row = await extractLoi(text, model, context);
      return row === null ? [] : [row];
    },
    instructions: loiInstructions,
    schema: () => LoiOutputSchema,
    keyField: "target_name",
    compareFields: ["target_name", "loi_date"],
  },
};

export interface EvalFixture {
  readonly name: string;
  /** Key into {@link EVAL_EXTRACTORS}. */
  readonly extractor: string;
  /** The section prose fed to the extractor. */
  readonly text: string;
  /** Golden rows — only the fields named here are scored. */
  readonly expected: readonly Record<string, unknown>[];
}

const OPERATING_COMPANY_MANAGEMENT = `MANAGEMENT

The following table sets forth information regarding our executive officers and directors as of the date of this prospectus.

Marcus T. Delgado, age 54, has served as our Chief Executive Officer and Chairman of the Board since our founding in 2015. Prior to founding the Company, Mr. Delgado spent twelve years at Nortonwind Industries, most recently as Senior Vice President of Operations.

Priya Ramaswamy, age 47, has served as our Chief Financial Officer since 2018. Before joining us, Ms. Ramaswamy served as Vice President of Finance at Halcyon Materials Corp. She is a certified public accountant.

Devin O'Leary, age 41, has served as our Chief Technology Officer since 2016. Mr. O'Leary previously led engineering teams at two venture-backed software startups.

Susan Whitfield-Chen, age 63, has served as a member of our Board of Directors since 2019. Ms. Whitfield-Chen currently serves as a director of two other public companies.`;

const SPAC_MANAGEMENT = `MANAGEMENT

Directors and Executive Officers

Our officers and directors are as follows:

Jonathan P. Reyes has served as our Chief Executive Officer and a director since inception. Mr. Reyes, 58, has more than 25 years of experience in private equity.

Aisha Nwosu, 44, has served as our Chief Financial Officer since inception. Ms. Nwosu was previously a managing director at a global investment bank.

Robert Kaminski, 67, serves as the Chairman of our board of directors. Mr. Kaminski has founded and led three prior blank check companies.`;

/**
 * Known-SPAC 8-K narratives for the `loi` extractor: three positives reporting
 * a NON-BINDING letter of intent / agreement in principle / MOU for a business
 * combination, and five confusable negatives it must not fire on (definitive
 * agreements, vote/redemption results, LOI terminations, a non-business-
 * combination LOI, routine trust mechanics).
 */
const LOI_CLEAR = `Item 8.01 Other Events.

On February 1, 2026, Meridian Acquisition Corp. (the "Company") announced that it has entered into a non-binding letter of intent with Acme Robotics, Inc., a developer of industrial automation systems, for a proposed business combination. The proposed transaction implies a pro forma enterprise value of approximately $450 million. Completion of the transaction is subject to, among other things, the negotiation and execution of a definitive agreement, satisfactory completion of due diligence, and approval by the Company's shareholders. There can be no assurance that a definitive agreement will be entered into or that the proposed transaction will be consummated.`;

const LOI_AGREEMENT_IN_PRINCIPLE = `Item 7.01 Regulation FD Disclosure.

Attached as Exhibit 99.1 is a press release issued by Pathfinder Acquisition Corp. II announcing that the Company and Helios Energy Holdings, LLC have reached an agreement in principle regarding a potential business combination. The agreement in principle is non-binding, and the terms of any transaction remain subject to the completion of due diligence and the execution of definitive documentation. The Company can provide no assurance that the potential transaction will proceed.`;

const LOI_MOU = `Item 1.01 Entry into a Material Definitive Agreement.

On March 14, 2026, Summit Ridge Acquisition Corp. entered into a memorandum of understanding (the "MOU") with Blue Harbor Foods S.A. relating to a proposed business combination. The MOU is non-binding except for certain provisions relating to exclusivity, confidentiality and expenses, pursuant to which the parties agreed to negotiate exclusively with each other for a period of 90 days. The proposed business combination remains subject to the negotiation and execution of a definitive business combination agreement.`;

const LOI_NEG_DEFINITIVE = `Item 1.01 Entry into a Material Definitive Agreement.

On April 2, 2026, Meridian Acquisition Corp. entered into an Agreement and Plan of Merger (the "Merger Agreement") with Acme Robotics, Inc. and MAC Merger Sub, Inc., a wholly owned subsidiary of the Company. Pursuant to the Merger Agreement, Merger Sub will merge with and into Acme Robotics, with Acme Robotics surviving as a wholly owned subsidiary of the Company. The board of directors of the Company has unanimously approved the Merger Agreement.`;

const LOI_NEG_VOTE = `Item 5.07 Submission of Matters to a Vote of Security Holders.

On June 10, 2026, the Company held an extraordinary general meeting of shareholders. Holders of 4,812,336 Class A ordinary shares properly exercised their right to redeem their shares for cash at a redemption price of approximately $10.42 per share, for an aggregate redemption amount of approximately $50.1 million. The business combination proposal was approved.`;

const LOI_NEG_TERMINATION = `Item 8.01 Other Events.

On July 8, 2026, Pathfinder Acquisition Corp. II announced that it has terminated the previously announced non-binding letter of intent with Helios Energy Holdings, LLC. The parties were unable to reach agreement on definitive documentation. The Company intends to continue evaluating other potential business combination targets.`;

const LOI_NEG_LEASE = `Item 8.01 Other Events.

On May 5, 2026, the Company entered into a non-binding letter of intent with Riverside Property Management LLC with respect to the lease of new office premises for its corporate headquarters. The proposed lease has a term of five years. The Company expects to execute a definitive lease agreement during the second quarter.`;

const LOI_NEG_TRUST = `Item 8.01 Other Events.

On January 20, 2026, the Company announced that, in order to extend the period of time it has to consummate its initial business combination by three months, its sponsor deposited $1,725,000 into the Company's trust account. The Company has not yet selected a business combination target and has not, nor has anyone on its behalf, initiated any substantive discussions with any business combination target.`;

/**
 * SPAC prospectus "The Offering" / "The Sponsor" prose for the `sponsor-promote`
 * extractor. A customary 20% founder promote, half-warrant public coverage, and
 * a $10.00 trust deposit, with the sponsor's private-placement warrants at $1.00.
 */
const SPONSOR_PROMOTE_STANDARD = `The Offering

We are offering 20,000,000 units at a price of $10.00 per unit. Each unit consists of one Class A ordinary share and one-half of one redeemable warrant. Each whole warrant entitles the holder to purchase one Class A ordinary share at a price of $11.50 per share.

Founder Shares. Our sponsor currently holds 5,000,000 Class B ordinary shares (the "founder shares"). The founder shares will represent 20% of our issued and outstanding shares after this offering.

Private Placement Warrants. Simultaneously with the closing of this offering, our sponsor has agreed to purchase an aggregate of 10,000,000 private placement warrants at a price of $1.00 per warrant, generating gross proceeds of $10,000,000.

Trust Account. A total of $200,000,000 (or $10.00 per public share) will be deposited into a trust account established for the benefit of our public shareholders.`;

/**
 * A richer offering where the sponsor over-funds the trust to $10.20 per share
 * and the private-placement warrants are priced at $1.50.
 */
const SPONSOR_PROMOTE_OVERFUNDED = `The Offering

This is an offering of 25,000,000 units at $10.00 per unit. Each unit is comprised of one Class A ordinary share and one-third of one redeemable warrant.

The Sponsor. Our sponsor owns 6,250,000 founder shares, representing approximately 20% of our outstanding ordinary shares following the completion of this offering. Our sponsor has committed to purchase 8,000,000 private placement warrants at $1.50 per warrant.

Of the net proceeds of this offering and the private placement, $255,000,000, or $10.20 per public share, will be placed in the trust account.`;

/**
 * Registration-summary prose for the `spac-classification` extractor: a true
 * blank-check SPAC (positive), a dormant reverse-merger shell (negative), and an
 * ordinary operating company (negative). The classifier must fire ONLY on the
 * true SPAC — the whole point is to catch a SIC-miscoded SPAC without
 * mislabeling a shell or an operating business.
 */
const CLASSIFY_TRUE_SPAC = `Prospectus Summary

We are a blank check company incorporated in the Cayman Islands as an exempted company and formed for the purpose of effecting a merger, share exchange, asset acquisition, share purchase, reorganization or similar business combination with one or more businesses. We have not selected any specific business combination target. A total of $200,000,000 will be deposited into a trust account for the benefit of our public shareholders. Our sponsor has purchased founder shares and private placement warrants.`;

const CLASSIFY_SHELL = `Prospectus Summary

We are a shell company with no current operations. We were previously engaged in mineral exploration, which we discontinued in 2021. We intend to identify and complete a reverse merger with an existing operating company that has already been identified by our management. We do not maintain a trust account and this is not a blank check offering.`;

const CLASSIFY_OPERATING = `Prospectus Summary

We are a leading designer and manufacturer of precision industrial pumps used in the oil and gas, chemical and water-treatment industries. Founded in 2004, we generated revenue of $312 million in the most recent fiscal year and operate four manufacturing facilities across North America. This prospectus relates to the initial public offering of our common stock.`;

/**
 * A SPAC ownership table exercising the conventions the prompt pins down: a
 * sponsor cell carrying a parenthetical annotation and footnote markers, holders
 * shown with "—" (still owners), and the trailing "as a group" subtotal — which
 * is an aggregate of the rows above it, not a stockholder, and must NOT be
 * emitted (it would otherwise be resolved into the canonical company tier and
 * double-count its members' shares).
 */
const SPAC_BENEFICIAL_OWNERSHIP = `PRINCIPAL STOCKHOLDERS

The following table sets forth information regarding the beneficial ownership of our common stock as of the date of this prospectus by each person known by us to be the beneficial owner of more than 5% of our outstanding shares, each of our officers and directors, and all our officers and directors as a group.

Name and Address of Beneficial Owner(1) | Number of Shares Beneficially Owned(2) | Approximate Percentage
Halyard Sponsor III LLC(our sponsor)(3) | 4,312,500 | 100.0%
Eleanor Vasquez(3)(4) | 4,312,500 | 100.0%
Desmond Achebe | — | —
Marta Lindqvist(4) | — | —
Peter Sandoval-Reyes(4) | 43,125 | *
All officers and directors as a group (five individuals) | 4,355,625 | 100.0%

____________
* Less than 1%.
(1) Unless otherwise noted, the business address of each is c/o Halyard Acquisition Corp., 88 Harbor Drive, Suite 400, Boston, MA 02110.
(2) Interests shown consist solely of founder shares.
(3) Our sponsor is the record holder of such shares. Eleanor Vasquez is the managing member of our sponsor and may be deemed to have sole beneficial ownership of the shares held by our sponsor.
(4) Each of these individuals holds a direct or indirect interest in our sponsor and disclaims beneficial ownership except to the extent of their pecuniary interest.`;

/**
 * An operating-company table with a selling stockholder and a 5% holder, to
 * balance the SPAC founder-share shape above.
 */
const OPERATING_BENEFICIAL_OWNERSHIP = `PRINCIPAL AND SELLING STOCKHOLDERS

The following table sets forth information regarding the beneficial ownership of our common stock as of the date of this prospectus.

Name of Beneficial Owner | Shares Owned Before Offering | Percent | Shares Offered | Shares After
Calder Ventures Fund II, L.P.(1) | 3,100,000 | 28.4% | 500,000 | 2,600,000
Marcus T. Delgado(2) | 1,250,000 | 11.5% | — | 1,250,000
Priya Ramaswamy | 310,000 | 2.8% | — | 310,000
Devin O'Leary | 148,500 | 1.4% | — | 148,500
Susan Whitfield-Chen | — | — | — | —
All directors and executive officers as a group (4 persons) | 1,708,500 | 15.7% | — | 1,708,500

(1) Calder Ventures Fund II, L.P. is managed by Calder Ventures GP, LLC.
(2) Includes 200,000 shares held by the Delgado Family Trust.`;

/**
 * Summary Compensation Table sections in the layout real EDGAR markup converts
 * to: caption cells stretched across the spacer columns that carry the `$` sign
 * and footnote markers, and the officer's name and principal position on
 * SEPARATE grid rows. In the first, those two rows carry DIFFERENT fiscal years,
 * which is the layout a model can misread by emitting the position line as a
 * second person.
 */
const COMPENSATION_TWO_YEAR_TABLE = `EXECUTIVE COMPENSATION

Our named executive officers for fiscal year 2025, consisting of our principal executive officer and the next two most highly compensated executive officers, were:

Alina Kowalczyk, Chief Executive Officer; Bertrand Osei, our Chief Operating Officer; and Chandra Villanueva, our Chief Financial Officer.

Summary Compensation Table

The following table presents all of the compensation awarded to, earned by, or paid to our named executive officers for the fiscal years ended December 31, 2025 and 2024.

| Name and Principal Position | Year | Year | Salary ($) | Salary ($) | Bonus ($)(1) | Bonus ($)(1) | Option awards ($)(2) | Option awards ($)(2) | All other compensation ($)(3) | All other compensation ($)(3) | Total ($) | Total ($) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Alina Kowalczyk |  | 2025 |  | 612,500 |  | 425,000 |  | 3,180,400 |  | 12,300 |  | 4,230,200 |
| Chief Executive Officer |  | 2024 |  | 570,000 |  | 285,000 |  | 1,940,000 |  | 11,800 |  | 2,806,800 |
| Bertrand Osei |  | 2025 |  | 448,750 |  | 224,375 |  | 1,102,600 |  | 9,450 |  | 1,785,175 |
| Chief Operating Officer |  | 2024 |  | 420,000 |  | 168,000 |  | 640,500 |  | 9,100 |  | 1,237,600 |
| Chandra Villanueva |  | 2025 |  | 415,000 |  | 207,500 |  | 968,300 |  | 9,450 |  | 1,600,250 |
| Chief Financial Officer |  | 2024 |  | 390,000 |  | 156,000 |  | 512,000 |  | 8,900 |  | 1,066,900 |

(1) Amounts reported represent discretionary bonuses paid with respect to the fiscal year shown.
(2) Amounts reported represent the aggregate grant date fair value computed in accordance with ASC Topic 718.
(3) Amounts reported represent 401(k) matching contributions paid by the Company.`;

const COMPENSATION_WITH_DIRECTOR_TABLE = `EXECUTIVE AND DIRECTOR COMPENSATION

Summary Compensation Table

| Name and Principal Position | Year | Salary ($) | Salary ($) | Bonus ($) | Bonus ($) | Stock awards ($)(1) | Stock awards ($)(1) | All other compensation ($) | All other compensation ($) | Total ($) | Total ($) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Halvard Nilsen(2) | 2025 |  | 325,000 |  | — |  | 748,000 |  | 14,200 |  | 1,087,200 |
| President and Chief Executive Officer |  |  |  |  |  |  |  |  |  |  |  |
| Renata Oyelaran | 2025 |  | 285,000 |  | 57,000 |  | 412,500 |  | 13,650 |  | 768,150 |
| Chief Financial Officer |  |  |  |  |  |  |  |  |  |  |  |

(1) Represents the aggregate grant date fair value of restricted stock unit awards.
(2) Mr. Nilsen was appointed President and Chief Executive Officer in January 2025.

Director Compensation

The following table sets forth information concerning the compensation paid to our non-employee directors for the fiscal year ended December 31, 2025.

| Name | Fees Earned or Paid in Cash ($) | Stock awards ($) | Total ($) |
| --- | --- | --- | --- |
| Tobias Brennan | 45,000 | 120,000 | 165,000 |
| Yuki Tanabe | 42,500 | 120,000 | 162,500 |`;
/**
 * Prospectus risk-factor prose for the `risk-factors` extractor: two category
 * headings, five captions with explanatory bodies underneath, plus the two
 * shapes the prompt forbids — the section's introductory paragraph and a
 * cross-reference to risks disclosed elsewhere — so emitting either costs
 * precision.
 */
const RISK_FACTORS_SPAC = `RISK FACTORS

An investment in our securities involves a high degree of risk. You should consider carefully all of the risks described below, together with the other information contained in this prospectus, before making a decision to invest in our units.

Risks Relating to our Search for, and Consummation of, a Business Combination

We are a blank check company with no operating history and no revenues, and you have no basis on which to evaluate our ability to achieve our business objective.

We are a recently incorporated company with no operating results, and we will not commence operations until obtaining funding through this offering. Because we lack an operating history, you have no basis upon which to evaluate our ability to achieve our business objective of completing our initial business combination.

Our public shareholders may not be afforded an opportunity to vote on our proposed initial business combination.

We may choose not to hold a shareholder vote before we complete our initial business combination if the business combination would not require shareholder approval under applicable law or stock exchange listing requirements.

If we are unable to consummate an initial business combination within 24 months of the closing of this offering, our public shareholders may receive only approximately $10.00 per share on the liquidation of our trust account.

We may not be able to find a suitable target business and complete our initial business combination within the prescribed time frame. Our sponsor, officers and directors have agreed that we must complete our initial business combination within 24 months of the closing of this offering.

Risks Relating to our Securities

There is currently no market for our securities and a market may never develop, which could adversely affect the liquidity and price of our securities.

There is currently no market for our securities. Shareholders therefore have no access to information about prior market history on which to base their investment decision.

We may issue additional shares or other equity securities without shareholder approval, which would dilute the ownership interests of our shareholders.

Our amended and restated memorandum and articles of association authorize the issuance of additional Class A ordinary shares and preference shares. We may issue such shares to complete our initial business combination.

For a discussion of the risks relating to our sponsor and its affiliates, see the section entitled "Risks Relating to our Sponsor and Management Team" in our most recent Annual Report on Form 10-K.`;

export const EVAL_FIXTURES: readonly EvalFixture[] = [
  {
    name: "executive-compensation-two-year-table",
    extractor: "executive-compensation",
    text: COMPENSATION_TWO_YEAR_TABLE,
    // One row per officer per fiscal year, in table order. A model that reads
    // the position line as a person emits "Chief Executive Officer" here, which
    // costs both the matched row and precision.
    expected: [
      { person_name: "Alina Kowalczyk", fiscal_year: 2025, salary: 612500, total: 4230200 },
      { person_name: "Alina Kowalczyk", fiscal_year: 2024, salary: 570000, total: 2806800 },
      { person_name: "Bertrand Osei", fiscal_year: 2025, salary: 448750, total: 1785175 },
      { person_name: "Bertrand Osei", fiscal_year: 2024, salary: 420000, total: 1237600 },
      { person_name: "Chandra Villanueva", fiscal_year: 2025, salary: 415000, total: 1600250 },
      { person_name: "Chandra Villanueva", fiscal_year: 2024, salary: 390000, total: 1066900 },
    ],
  },
  {
    name: "executive-compensation-with-director-table",
    extractor: "executive-compensation",
    text: COMPENSATION_WITH_DIRECTOR_TABLE,
    // The two non-employee directors are deliberately absent: they belong to
    // the separate Item 402(r) table under the same heading, so emitting them
    // costs precision — which is the behavior we want to measure.
    expected: [
      { person_name: "Halvard Nilsen", fiscal_year: 2025, salary: 325000, total: 1087200 },
      { person_name: "Renata Oyelaran", fiscal_year: 2025, salary: 285000, total: 768150 },
    ],
  },
  {
    name: "beneficial-ownership-spac-founder-table",
    extractor: "beneficial-ownership",
    text: SPAC_BENEFICIAL_OWNERSHIP,
    // Only `name` is scored. The "as a group" subtotal is deliberately absent:
    // emitting it costs precision, which is the behavior we want to measure.
    expected: [
      { name: "Halyard Sponsor III LLC" },
      { name: "Eleanor Vasquez" },
      { name: "Desmond Achebe" },
      { name: "Marta Lindqvist" },
      { name: "Peter Sandoval-Reyes" },
    ],
  },
  {
    name: "beneficial-ownership-operating-company-table",
    extractor: "beneficial-ownership",
    text: OPERATING_BENEFICIAL_OWNERSHIP,
    expected: [
      { name: "Calder Ventures Fund II, L.P." },
      { name: "Marcus T. Delgado" },
      { name: "Priya Ramaswamy" },
      { name: "Devin O'Leary" },
      { name: "Susan Whitfield-Chen" },
    ],
  },
  {
    name: "spac-classification-true-spac",
    extractor: "spac-classification",
    text: CLASSIFY_TRUE_SPAC,
    expected: [{ is_spac: true, entity_kind: "spac" }],
  },
  {
    name: "spac-classification-negative-shell",
    extractor: "spac-classification",
    text: CLASSIFY_SHELL,
    expected: [],
  },
  {
    name: "spac-classification-negative-operating",
    extractor: "spac-classification",
    text: CLASSIFY_OPERATING,
    expected: [],
  },
  {
    name: "risk-factors-spac-two-categories",
    extractor: "risk-factors",
    text: RISK_FACTORS_SPAC,
    expected: [
      {
        headline:
          "We are a blank check company with no operating history and no revenues, and you have no basis on which to evaluate our ability to achieve our business objective.",
        category: "Risks Relating to our Search for, and Consummation of, a Business Combination",
      },
      {
        headline:
          "Our public shareholders may not be afforded an opportunity to vote on our proposed initial business combination.",
        category: "Risks Relating to our Search for, and Consummation of, a Business Combination",
      },
      {
        headline:
          "If we are unable to consummate an initial business combination within 24 months of the closing of this offering, our public shareholders may receive only approximately $10.00 per share on the liquidation of our trust account.",
        category: "Risks Relating to our Search for, and Consummation of, a Business Combination",
      },
      {
        headline:
          "There is currently no market for our securities and a market may never develop, which could adversely affect the liquidity and price of our securities.",
        category: "Risks Relating to our Securities",
      },
      {
        headline:
          "We may issue additional shares or other equity securities without shareholder approval, which would dilute the ownership interests of our shareholders.",
        category: "Risks Relating to our Securities",
      },
    ],
  },
  {
    name: "s1-management-operating-company",
    extractor: "management",
    text: OPERATING_COMPANY_MANAGEMENT,
    expected: [
      {
        full_name: "Marcus T. Delgado",
        titles: ["Chief Executive Officer", "Chairman of the Board of Directors"],
      },
      { full_name: "Priya Ramaswamy", titles: ["Chief Financial Officer"] },
      { full_name: "Devin O'Leary", titles: ["Chief Technology Officer"] },
      { full_name: "Susan Whitfield-Chen", titles: ["Director"] },
    ],
  },
  {
    name: "s1-management-spac",
    extractor: "management",
    text: SPAC_MANAGEMENT,
    expected: [
      { full_name: "Jonathan P. Reyes", titles: ["Chief Executive Officer", "Director"] },
      { full_name: "Aisha Nwosu", titles: ["Chief Financial Officer"] },
      { full_name: "Robert Kaminski", titles: ["Chairman of the Board of Directors"] },
    ],
  },
  {
    name: "sponsor-promote-standard-20pct",
    extractor: "sponsor-promote",
    text: SPONSOR_PROMOTE_STANDARD,
    expected: [
      {
        founder_shares: 5000000,
        founder_percent: 0.2,
        private_placement_warrants: 10000000,
        public_warrant_coverage: 0.5,
        trust_per_public_share: 10.0,
      },
    ],
  },
  {
    name: "sponsor-promote-overfunded-trust",
    extractor: "sponsor-promote",
    text: SPONSOR_PROMOTE_OVERFUNDED,
    expected: [
      {
        founder_shares: 6250000,
        founder_percent: 0.2,
        private_placement_warrants: 8000000,
        public_warrant_coverage: 0.3333,
        trust_per_public_share: 10.2,
      },
    ],
  },
  {
    name: "loi-8k-clear-nonbinding-loi",
    extractor: "loi",
    text: LOI_CLEAR,
    expected: [{ target_name: "Acme Robotics, Inc.", loi_date: "2026-02-01" }],
  },
  {
    name: "loi-8k-agreement-in-principle",
    extractor: "loi",
    text: LOI_AGREEMENT_IN_PRINCIPLE,
    expected: [{ target_name: "Helios Energy Holdings, LLC" }],
  },
  {
    name: "loi-8k-nonbinding-mou-with-exclusivity",
    extractor: "loi",
    text: LOI_MOU,
    expected: [{ target_name: "Blue Harbor Foods S.A.", loi_date: "2026-03-14" }],
  },
  {
    name: "loi-8k-negative-definitive-merger-agreement",
    extractor: "loi",
    text: LOI_NEG_DEFINITIVE,
    expected: [],
  },
  {
    name: "loi-8k-negative-vote-and-redemptions",
    extractor: "loi",
    text: LOI_NEG_VOTE,
    expected: [],
  },
  {
    name: "loi-8k-negative-loi-termination",
    extractor: "loi",
    text: LOI_NEG_TERMINATION,
    expected: [],
  },
  {
    name: "loi-8k-negative-office-lease-loi",
    extractor: "loi",
    text: LOI_NEG_LEASE,
    expected: [],
  },
  {
    name: "loi-8k-negative-trust-extension",
    extractor: "loi",
    text: LOI_NEG_TRUST,
    expected: [],
  },
];
