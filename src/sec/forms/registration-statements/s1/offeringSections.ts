/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import type { EntityObserver } from "../../../../resolver/EntityObserver";
import { UnderwriterFamilyResolver } from "../../../../resolver/UnderwriterFamilyResolver";
import { CanonicalUnderwriterFamilyRepo } from "../../../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../../../../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { UnderwriterFamilyMembershipRepo } from "../../../../storage/canonical/UnderwriterFamilyMembershipRepo";
import { UnderwriterLinkRepo } from "../../../../storage/canonical/UnderwriterLinkRepo";
import { OfferingTermsRepo } from "../../../../storage/offering/OfferingTermsRepo";
import { SpacUnitTermsRepo } from "../../../../storage/offering/SpacUnitTermsRepo";
import { IssuerTickerRepo } from "../../../../storage/offering/IssuerTickerRepo";
import type { ObservationProvenanceRepo } from "../../../../storage/provenance/ObservationProvenanceRepo";
import { UseOfProceedsRepo } from "../../../../storage/use-of-proceeds/UseOfProceedsRepo";
import { S1_SECTIONS, type S1SectionName } from "./DocumentSegmenter";
import {
  extractOfferingTerms,
  extractUnderwriters,
  extractUseOfProceeds,
} from "./sectionExtractors";
import type { RunSection } from "./sectionRunner";

/** Section names used by the offering-related dead letters. */
export const OFFERING_SECTION_NAMES = [
  "offering-terms",
  "underwriters",
  "use-of-proceeds",
] as const;

/**
 * Share/unit counts are emitted by the model as plain numbers but stored in
 * integer-typed columns. Round a finite value to the nearest integer (a stray
 * decimal would otherwise be rejected on write and dead-letter the whole
 * section); pass through null.
 */
export function toIntCount(n: number | null | undefined): number | null {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

export interface OfferingSectionsArgs {
  readonly runSection: RunSection;
  readonly observer: EntityObserver;
  readonly provenance: ObservationProvenanceRepo;
  /** Allocates the next observation_index in the caller's per-filing sequence. */
  readonly nextIndex: () => number;
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly cik: number;
  readonly filing_date: string;
  readonly isSpac: boolean;
  readonly model: ModelConfig;
  readonly model_id: string | null;
  readonly activeUnderwriterFamilyVersion: string;
  readonly byName: ReadonlyMap<S1SectionName, string>;
}

/**
 * The deal itself, extracted from prospectus text: offering terms (equity →
 * `offering_terms`, SPAC units → `spac_unit_terms`) plus the exact ticker
 * series, underwriters rolled up to families, and use-of-proceeds line items.
 * Shared by the S-1 registration processor and the 424 priced-prospectus
 * processor (which records the final deal under extractor id `424`).
 */
export async function runOfferingSections(args: OfferingSectionsArgs): Promise<void> {
  const {
    runSection,
    observer,
    provenance,
    nextIndex,
    accession_number,
    extractor_id,
    extractor_version,
    cik,
    filing_date,
    isSpac,
    model,
    model_id,
    activeUnderwriterFamilyVersion,
    byName,
  } = args;
  const base = { accession_number, extractor_id, extractor_version };

  const offeringTermsRepo = new OfferingTermsRepo();
  const spacUnitTermsRepo = new SpacUnitTermsRepo();
  const issuerTickerRepo = new IssuerTickerRepo();
  const useOfProceedsRepo = new UseOfProceedsRepo();
  const underwriterFamilyResolver = new UnderwriterFamilyResolver({
    canonicalUnderwriterFamilyRepo: new CanonicalUnderwriterFamilyRepo(),
    canonicalUnderwriterFamilyAliasRepo: new CanonicalUnderwriterFamilyAliasRepo(),
    activeResolverVersion: activeUnderwriterFamilyVersion,
  });
  const underwriterMembershipRepo = new UnderwriterFamilyMembershipRepo();
  const underwriterLinkRepo = new UnderwriterLinkRepo();

  await issuerTickerRepo.clear(accession_number);
  await underwriterLinkRepo.clear(accession_number);
  await useOfProceedsRepo.clear(accession_number);

  // --- Offering terms (read from The Offering + Underwriting) ---
  // The extractor returns a single object; adapt it onto runSection by treating
  // a null result as an empty array and wrapping a present result as `[terms]`.
  const offeringText = [byName.get(S1_SECTIONS.THE_OFFERING), byName.get(S1_SECTIONS.UNDERWRITING)]
    .filter((t): t is string => typeof t === "string")
    .join("\n\n");
  await runSection({
    sectionName: "offering-terms",
    text: offeringText,
    notFoundDetail: "no The Offering / Underwriting section text",
    emptyDetail: "no offering terms returned",
    lowConfidenceDetail: "below confidence floor",
    extract: async (text) => {
      const terms = await extractOfferingTerms(text, model);
      return terms === null ? [] : [terms];
    },
    persist: async (rows) => {
      const terms = rows[0];
      const now = new Date().toISOString();
      if (isSpac) {
        await spacUnitTermsRepo.save({
          extractor_id,
          accession_number,
          cik,
          units_offered: toIntCount(terms.units_offered),
          price_per_unit: terms.price_per_unit,
          unit_composition: terms.unit_composition,
          warrant_fraction_per_unit: terms.warrant_fraction_per_unit,
          right_fraction_per_unit: terms.right_fraction_per_unit,
          trust_per_unit: terms.trust_per_unit,
          over_allotment_units: toIntCount(terms.over_allotment_units),
          exchange: terms.exchange,
          ticker: terms.tickers.find((t) => t.is_primary)?.ticker ?? null,
          gross_proceeds: terms.gross_proceeds,
          net_proceeds: terms.net_proceeds,
          confidence: terms.confidence,
          source_span: terms.source_span,
          created_at: now,
        });
      } else {
        await offeringTermsRepo.save({
          extractor_id,
          accession_number,
          cik,
          security_type: terms.security_type,
          shares_offered: toIntCount(terms.shares_offered),
          price: terms.price,
          price_low: terms.price_low,
          price_high: terms.price_high,
          gross_proceeds: terms.gross_proceeds,
          net_proceeds: terms.net_proceeds,
          over_allotment_shares: toIntCount(terms.over_allotment_shares),
          exchange: terms.exchange,
          ticker: terms.tickers.find((t) => t.is_primary)?.ticker ?? null,
          par_value: terms.par_value,
          confidence: terms.confidence,
          source_span: terms.source_span,
          created_at: now,
        });
      }
      for (const t of terms.tickers) {
        const ticker = t.ticker?.trim() ?? "";
        if (ticker === "") continue;
        await issuerTickerRepo.save({
          extractor_id,
          accession_number,
          exchange: (t.exchange ?? terms.exchange ?? "").trim(),
          ticker,
          cik,
          filing_date,
          security_type: t.security_type,
          is_primary: t.is_primary,
          confidence: terms.confidence,
          source_span: terms.source_span,
          created_at: now,
        });
      }
      return 1;
    },
  });

  // --- Underwriters (Underwriting section; all filings) ---
  await runSection({
    sectionName: "underwriters",
    text: byName.get(S1_SECTIONS.UNDERWRITING),
    emptyDetail: "no underwriters returned",
    lowConfidenceDetail: "all rows below confidence floor",
    invalidWriteDetail: "no underwriter rows had usable legal and common names",
    extract: (text) => extractUnderwriters(text, model),
    persist: async (rows) => {
      let wrote = 0;
      for (const r of rows) {
        const legalName = r.legal_name?.trim() ?? "";
        const commonName = r.common_name?.trim() ?? "";
        if (legalName === "" || commonName === "") continue;
        const observation_index = nextIndex();
        const { observation_id, canonical_company_id } = await observer.observeCompany({
          ...base,
          observation_index,
          name: legalName,
          source_context: JSON.stringify({ relation: "s1:underwriter" }),
        });
        await provenance.save({
          kind: "company",
          observation_id,
          confidence: r.confidence,
          source_span: r.source_span,
          section_name: "underwriters",
          model_id,
          prompt_version: extractor_version,
          extra: null,
        });
        const underwriter_family_id = await underwriterFamilyResolver.resolve(commonName);
        await underwriterMembershipRepo.record({
          resolver_version: activeUnderwriterFamilyVersion,
          canonical_company_id,
          canonical_underwriter_family_id: underwriter_family_id,
          seen_at: new Date().toISOString(),
        });
        await underwriterLinkRepo.save({
          accession_number,
          extractor_id,
          observation_index,
          issuer_cik: cik,
          underwriter_canonical_company_id: canonical_company_id,
          underwriter_family_id,
          role_detail: r.role,
          shares_allocated: toIntCount(r.shares_allocated),
          over_allotment_shares: toIntCount(r.over_allotment_shares),
          resolver_version: activeUnderwriterFamilyVersion,
        });
        wrote++;
      }
      return wrote;
    },
  });

  // --- Use of proceeds ---
  await runSection({
    sectionName: "use-of-proceeds",
    text: byName.get(S1_SECTIONS.USE_OF_PROCEEDS),
    emptyDetail: "no line items returned",
    lowConfidenceDetail: "all rows below confidence floor",
    extract: (text) => extractUseOfProceeds(text, model),
    persist: async (rows) => {
      const now = new Date().toISOString();
      let lineIndex = 0;
      for (const r of rows) {
        await useOfProceedsRepo.save({
          extractor_id,
          accession_number,
          line_index: lineIndex++,
          cik,
          purpose: r.purpose,
          amount: r.amount,
          percent: r.percent,
          note: r.note,
          confidence: r.confidence,
          source_span: r.source_span,
          created_at: now,
        });
      }
      return rows.length;
    },
  });
}
