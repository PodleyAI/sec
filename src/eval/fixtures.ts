/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import {
  extractBeneficialOwnership,
  extractManagement,
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
    compareFields: ["full_name", "title"],
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

export const EVAL_FIXTURES: readonly EvalFixture[] = [
  {
    name: "s1-management-operating-company",
    extractor: "management",
    text: OPERATING_COMPANY_MANAGEMENT,
    expected: [
      { full_name: "Marcus T. Delgado", title: "Chief Executive Officer and Chairman of the Board" },
      { full_name: "Priya Ramaswamy", title: "Chief Financial Officer" },
      { full_name: "Devin O'Leary", title: "Chief Technology Officer" },
      { full_name: "Susan Whitfield-Chen", title: "Director" },
    ],
  },
  {
    name: "s1-management-spac",
    extractor: "management",
    text: SPAC_MANAGEMENT,
    expected: [
      { full_name: "Jonathan P. Reyes", title: "Chief Executive Officer and Director" },
      { full_name: "Aisha Nwosu", title: "Chief Financial Officer" },
      { full_name: "Robert Kaminski", title: "Chairman of the Board of Directors" },
    ],
  },
];
