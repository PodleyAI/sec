/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import {
  extractBeneficialOwnership,
  extractLoi,
  extractManagement,
  extractOfferingTerms,
  extractRelatedParty,
} from "../sec/forms/registration-statements/s1/sectionExtractors";

/**
 * A section extractor the harness can drive: it takes section prose + a model
 * and returns an array of row objects (single-object extractors wrap their one
 * result). `keyField` aligns candidate rows with a fixture's expected rows; omit
 * it for positional (single-object / order-stable) extractors.
 */
export interface EvalExtractor {
  readonly run: (text: string, model: ModelConfig) => Promise<unknown[]>;
  readonly keyField?: string;
  /**
   * Fields that count toward the score when comparing against a reference (used
   * by the oracle eval, where the reference model's rows carry every field —
   * `confidence`, `source_span`, etc. — that we do NOT want to score on).
   * Defaults (when unset) to comparing every field of the expected row.
   */
  readonly compareFields?: readonly string[];
  /**
   * Approximate non-text prompt overhead (instructions + untrusted-input
   * scaffolding) in characters, added to the section text for the input-cost
   * estimate. A rough constant is fine — cost is comparative, not billed.
   */
  readonly instructionOverheadChars: number;
}

/**
 * Registry of extractors the `sec eval` harness can exercise, keyed by the name
 * a fixture (and `--extractor`) references. Extend by adding an entry and a
 * matching fixture below.
 */
export const EVAL_EXTRACTORS: Record<string, EvalExtractor> = {
  management: {
    run: (text, model) => extractManagement(text, model),
    keyField: "full_name",
    compareFields: ["full_name", "titles"],
    instructionOverheadChars: 900,
  },
  "beneficial-ownership": {
    run: (text, model) => extractBeneficialOwnership(text, model),
    keyField: "name",
    // Percentages/share counts are formatted too variably to score cleanly;
    // compare on who is listed (name) — the field the models should agree on.
    compareFields: ["name"],
    instructionOverheadChars: 1000,
  },
  "related-party": {
    run: (text, model) => extractRelatedParty(text, model),
    keyField: "name",
    compareFields: ["name"],
    instructionOverheadChars: 900,
  },
  // Single-object extractor over an S-1/424 "The Offering" section; positional
  // alignment (no keyField). Scored on the objective numeric unit terms.
  "offering-terms": {
    run: async (text, model) => {
      const row = await extractOfferingTerms(text, model);
      return row === null ? [] : [row];
    },
    compareFields: [
      "price_per_unit",
      "warrant_fraction_per_unit",
      "right_fraction_per_unit",
      "trust_per_unit",
    ],
    instructionOverheadChars: 1300,
  },
  // Detection-style single-object extractor over a known-SPAC 8-K narrative:
  // a non-binding letter of intent yields one row; anything else (definitive
  // agreements, vote results, LOI terminations) yields none, so a fixture with
  // `expected: []` scores a false positive as lost precision.
  loi: {
    run: async (text, model) => {
      const row = await extractLoi(text, model);
      return row === null ? [] : [row];
    },
    keyField: "target_name",
    compareFields: ["target_name", "loi_date"],
    instructionOverheadChars: 1200,
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

export const EVAL_FIXTURES: readonly EvalFixture[] = [
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
