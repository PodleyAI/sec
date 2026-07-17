/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import type { ITabularStorage } from "workglow";
import { createServiceToken } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeNullable } from "../../util/TypeBoxUtil";

/**
 * Sponsor promote economics for a SPAC filing (one row per SPAC prospectus).
 * Captures the founder-share promote, private-placement warrant coverage, and
 * trust sizing the S-1/424 discloses — the figures that quantify sponsor
 * incentives and public-share dilution. Keyed `(extractor_id, accession_number)`
 * like the other offering tables so an S-1's registered promote and a 424's
 * final promote can be compared across extractor ids.
 */
export const SpacPromoteTermsSchema = Type.Object({
  extractor_id: Type.String({ maxLength: 16 }),
  accession_number: Type.String({ maxLength: 25 }),
  cik: TypeNullable(TypeSecCik()),
  // Founder (Class B / promote) shares.
  founder_shares: TypeNullable(Type.Integer()),
  founder_percent: TypeNullable(
    Type.Number({ description: "Founder shares as a fraction of post-IPO shares (e.g. 0.20)" })
  ),
  // Private-placement (sponsor) warrants + public warrant coverage.
  private_placement_warrants: TypeNullable(Type.Integer()),
  private_placement_warrant_price: TypeNullable(Type.Number()),
  public_warrant_coverage: TypeNullable(
    Type.Number({ description: "Warrant fraction per public unit (e.g. 0.5)" })
  ),
  // Trust sizing.
  trust_per_public_share: TypeNullable(
    Type.Number({ description: "Amount deposited in trust per public share (e.g. 10.20)" })
  ),
  trust_total: TypeNullable(Type.Number({ description: "Total amount held in trust" })),
  confidence: TypeNullable(Type.Number()),
  source_span: TypeNullable(Type.String()),
  created_at: Type.String(),
});
export type SpacPromoteTerms = Static<typeof SpacPromoteTermsSchema>;

export const SpacPromoteTermsPrimaryKeyNames = ["extractor_id", "accession_number"] as const;

export type SpacPromoteTermsRepositoryStorage = ITabularStorage<
  typeof SpacPromoteTermsSchema,
  typeof SpacPromoteTermsPrimaryKeyNames,
  SpacPromoteTerms
>;

export const SPAC_PROMOTE_TERMS_REPOSITORY_TOKEN =
  createServiceToken<SpacPromoteTermsRepositoryStorage>("sec.storage.spacPromoteTermsRepository");
