/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type ModelConfig } from "workglow";
import { EntityObserver } from "../../../resolver/EntityObserver";
import { PersonResolver } from "../../../resolver/PersonResolver";
import { CompanyResolver } from "../../../resolver/CompanyResolver";
import { PersonObservationRepo } from "../../../storage/observation/PersonObservationRepo";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { PersonIdentityLinkRepo } from "../../../storage/canonical/PersonIdentityLinkRepo";
import { CompanyIdentityLinkRepo } from "../../../storage/canonical/CompanyIdentityLinkRepo";
import { CanonicalPersonRepo } from "../../../storage/canonical/CanonicalPersonRepo";
import { CanonicalCompanyRepo } from "../../../storage/canonical/CanonicalCompanyRepo";
import { CanonicalPersonAliasRepo } from "../../../storage/canonical/CanonicalPersonAliasRepo";
import { CanonicalCompanyAliasRepo } from "../../../storage/canonical/CanonicalCompanyAliasRepo";
import { CanonicalPersonAddressRepo } from "../../../storage/canonical/CanonicalPersonAddressRepo";
import { CanonicalPersonPhoneRepo } from "../../../storage/canonical/CanonicalPersonPhoneRepo";
import { CanonicalCompanyAddressRepo } from "../../../storage/canonical/CanonicalCompanyAddressRepo";
import { CanonicalCompanyPhoneRepo } from "../../../storage/canonical/CanonicalCompanyPhoneRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { BeneficialOwnershipRepo } from "../../../storage/beneficial-ownership/BeneficialOwnershipRepo";
import { RelatedPartyTransactionRepo } from "../../../storage/related-party/RelatedPartyTransactionRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { S1ClassificationRepo } from "../../../storage/classification/S1ClassificationRepo";
import { CanonicalSponsorFamilyRepo } from "../../../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../../../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { SponsorFamilyResolver } from "../../../resolver/SponsorFamilyResolver";
import { SponsorFamilyMembershipRepo } from "../../../storage/canonical/SponsorFamilyMembershipRepo";
import { SpacSponsorLinkRepo } from "../../../storage/canonical/SpacSponsorLinkRepo";
import { OfferingTermsRepo } from "../../../storage/offering/OfferingTermsRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { CanonicalUnderwriterFamilyRepo } from "../../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../../../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { UnderwriterFamilyResolver } from "../../../resolver/UnderwriterFamilyResolver";
import { UnderwriterFamilyMembershipRepo } from "../../../storage/canonical/UnderwriterFamilyMembershipRepo";
import { UnderwriterLinkRepo } from "../../../storage/canonical/UnderwriterLinkRepo";
import { UseOfProceedsRepo } from "../../../storage/use-of-proceeds/UseOfProceedsRepo";
import type { FormS1Parsed } from "./Form_S_1";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { S1_SECTIONS, type S1SectionName } from "./s1/DocumentSegmenter";
import { spanAppearsIn } from "./s1/verifySourceSpan";
import {
  extractBeneficialOwnership,
  extractManagement,
  extractOfferingTerms,
  extractRelatedParty,
  extractSpacSponsors,
  extractUnderwriters,
  extractUseOfProceeds,
} from "./s1/sectionExtractors";
import { getS1Model } from "./s1/s1Model";
import { splitPersonName } from "./s1/splitName";

const EXTRACTOR_ID = "S-1";
// v1.1.0: SPAC sponsor extraction now requires the LLM-returned source_span to
// appear verbatim (after light normalization) in the section text before a
// canonical sponsor row is persisted.
const DEFAULT_EXTRACTOR_VERSION = "1.1.0";
const RAW_CONFIDENCE_FLOOR = Number(process.env.SEC_S1_CONFIDENCE_FLOOR ?? "0");
// A non-numeric SEC_S1_CONFIDENCE_FLOOR would be NaN, and `confidence >= NaN` is
// always false — silently dropping every row. Fall back to 0 (no floor).
const CONFIDENCE_FLOOR = Number.isFinite(RAW_CONFIDENCE_FLOOR) ? RAW_CONFIDENCE_FLOOR : 0;

/**
 * Share/unit counts are emitted by the model as plain numbers but stored in
 * integer-typed columns. Round a finite value to the nearest integer (a stray
 * decimal would otherwise be rejected on write and dead-letter the whole
 * section); pass through null.
 */
function toIntCount(n: number | null | undefined): number | null {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

export interface ProcessFormS1Args {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly formS1: FormS1Parsed;
  readonly model?: ModelConfig;
}

export async function processFormS1(args: ProcessFormS1Args): Promise<void> {
  const { cik, accession_number, formS1 } = args;
  const model = args.model ?? (await getS1Model());
  // Production resolves a ModelRecord (keyed `model_id`); the test fake uses `model`.
  // Accept either so provenance records the real model identifier in both paths.
  const modelRef = model as { model_id?: unknown; model?: unknown };
  const model_id =
    typeof modelRef.model_id === "string"
      ? modelRef.model_id
      : typeof modelRef.model === "string"
        ? modelRef.model
        : null;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const [extractorSlot, personSlot, companySlot, sponsorFamilySlot, underwriterFamilySlot] =
    await Promise.all([
      getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID),
      getActiveSlot(versionRegistry, "resolver", "person"),
      getActiveSlot(versionRegistry, "resolver", "company"),
      getActiveSlot(versionRegistry, "resolver", "sponsor-family"),
      getActiveSlot(versionRegistry, "resolver", "underwriter-family"),
    ]);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  const activeResolverPersonVersion = personSlot?.semver ?? "1.0.0";
  const activeResolverCompanyVersion = companySlot?.semver ?? "1.0.0";
  const activeSponsorFamilyVersion = sponsorFamilySlot?.semver ?? "1.0.0";
  const activeUnderwriterFamilyVersion = underwriterFamilySlot?.semver ?? "1.0.0";

  const personResolver = new PersonResolver({
    canonicalPersonRepo: new CanonicalPersonRepo(),
    canonicalPersonAliasRepo: new CanonicalPersonAliasRepo(),
    activeResolverVersion: activeResolverPersonVersion,
  });
  const companyResolver = new CompanyResolver({
    canonicalCompanyRepo: new CanonicalCompanyRepo(),
    canonicalCompanyAliasRepo: new CanonicalCompanyAliasRepo(),
    activeResolverVersion: activeResolverCompanyVersion,
  });
  const observer = new EntityObserver({
    personObservationRepo: new PersonObservationRepo(),
    companyObservationRepo: new CompanyObservationRepo(),
    personIdentityLinkRepo: new PersonIdentityLinkRepo(),
    companyIdentityLinkRepo: new CompanyIdentityLinkRepo(),
    personResolver,
    companyResolver,
    canonicalPersonAddressRepo: new CanonicalPersonAddressRepo(),
    canonicalPersonPhoneRepo: new CanonicalPersonPhoneRepo(),
    canonicalCompanyAddressRepo: new CanonicalCompanyAddressRepo(),
    canonicalCompanyPhoneRepo: new CanonicalCompanyPhoneRepo(),
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });

  const provenance = new ObservationProvenanceRepo();
  const ownershipRepo = new BeneficialOwnershipRepo();
  const relatedRepo = new RelatedPartyTransactionRepo();
  const deadLetters = new ExtractionDeadLetterRepo();

  const sponsorFamilyResolver = new SponsorFamilyResolver({
    canonicalSponsorFamilyRepo: new CanonicalSponsorFamilyRepo(),
    canonicalSponsorFamilyAliasRepo: new CanonicalSponsorFamilyAliasRepo(),
    activeResolverVersion: activeSponsorFamilyVersion,
  });
  const membershipRepo = new SponsorFamilyMembershipRepo();
  const linkRepo = new SpacSponsorLinkRepo();

  const offeringTermsRepo = new OfferingTermsRepo();
  const spacUnitTermsRepo = new SpacUnitTermsRepo();
  const issuerTickerRepo = new IssuerTickerRepo();

  const underwriterFamilyResolver = new UnderwriterFamilyResolver({
    canonicalUnderwriterFamilyRepo: new CanonicalUnderwriterFamilyRepo(),
    canonicalUnderwriterFamilyAliasRepo: new CanonicalUnderwriterFamilyAliasRepo(),
    activeResolverVersion: activeUnderwriterFamilyVersion,
  });
  const underwriterMembershipRepo = new UnderwriterFamilyMembershipRepo();
  const underwriterLinkRepo = new UnderwriterLinkRepo();
  const useOfProceedsRepo = new UseOfProceedsRepo();

  await ownershipRepo.clear(accession_number);
  await relatedRepo.clear(accession_number);
  await linkRepo.clear(accession_number);
  await issuerTickerRepo.clear(accession_number);
  await underwriterLinkRepo.clear(accession_number);
  await useOfProceedsRepo.clear(accession_number);

  const base = { accession_number, extractor_id: EXTRACTOR_ID, extractor_version };
  let idx = 0;

  await observer.observeCompany({
    ...base,
    observation_index: idx++,
    cik,
    source_context: JSON.stringify({ relation: "s1:issuer" }),
  });

  // --- Deterministic SPAC classification from the SGML-header SIC ---
  const headerSic = formS1.header?.sic ?? null;
  const isSpac = headerSic === 6770;
  await new S1ClassificationRepo().save({
    extractor_id: EXTRACTOR_ID,
    accession_number,
    cik,
    sic: headerSic,
    sic_description: formS1.header?.sicDescription ?? null,
    is_spac: isSpac,
    classifier_source: headerSic === null ? "sic-unknown" : "sgml-header",
    created_at: new Date().toISOString(),
  });

  const recordFail = (section: S1SectionName, reason: string, detail: string | null) =>
    deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: section,
      reason_code: reason,
      detail,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });

  // Converting real-world HTML can throw on malformed/adversarial input. A throw
  // here would abort the whole filing with no record; instead dead-letter every
  // target section as PARSE_ERROR so the filing stays on the retry worklist.
  let byName: Map<S1SectionName, string>;
  try {
    const doc = parseEdgarHtml(formS1.html, `S-1 ${accession_number}`);
    const sections = new DocumentTreeSegmenter().segment(doc);
    byName = new Map<S1SectionName, string>(sections.map((s) => [s.name, s.text]));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const section of Object.values(S1_SECTIONS)) {
      await recordFail(section, "PARSE_ERROR", detail);
    }
    return;
  }
  const recordOk = (section: S1SectionName) =>
    deadLetters.markResolved(EXTRACTOR_ID, accession_number, section);

  /**
   * Shared per-section ceremony: resolve text, dead-letter when absent, run the
   * extractor, apply the confidence floor, persist surviving rows, and emit the
   * resolved / empty / low-confidence / invalid-output dead letters. All seven
   * S-1 sections funnel through here so the policy lives in exactly one place.
   *
   * `section_name` doubles as the dead-letter `section_name`; it is the
   * `S1SectionName` for the entity sections and a literal string for the
   * derived offering / underwriter / proceeds / sponsor sections.
   */
  async function runSection<TRow extends { confidence: number }>(sargs: {
    sectionName: string;
    text: string | undefined;
    skip?: boolean;
    notFoundDetail?: string | null;
    emptyDetail: string;
    lowConfidenceDetail: string;
    // When set, a persist that writes 0 of N rows (e.g. all underwriter/sponsor
    // rows had blank names) dead-letters MODEL_INVALID_OUTPUT. Omit for sections
    // whose persist always writes every confident row, so they always markResolved.
    invalidWriteDetail?: string;
    // Optional row-level verification applied AFTER the confidence floor. When
    // every confident row is dropped, the section dead-letters as
    // UNVERIFIED_SOURCE_SPAN (using `unverifiedAllDetail`); when some are
    // dropped, the surviving rows persist normally AND a "<sectionName>-partial"
    // dead-letter is recorded for triage (using `unverifiedPartialDetail`).
    // Detail strings may use `$N` (dropped count) and `$T` (confident total).
    // `NoInfer<TRow>` keeps TRow inferred solely from `extract` — without it,
    // contextual typing of the verifyRow callback's parameter would pin TRow
    // to the constraint and break the persist callback's row typing.
    verifyRow?: (text: string, row: NoInfer<TRow>) => boolean;
    unverifiedAllDetail?: string;
    unverifiedPartialDetail?: string;
    extract: (text: string) => Promise<TRow[]>;
    persist: (rows: TRow[]) => Promise<number>;
  }): Promise<void> {
    if (sargs.skip) return;

    const record = (reason: string, detail: string | null) =>
      deadLetters.record({
        extractor_id: EXTRACTOR_ID,
        accession_number,
        section_name: sargs.sectionName,
        reason_code: reason,
        detail,
        failed_extractor_version: extractor_version,
        source_run_id: null,
      });

    if (sargs.text === undefined || sargs.text.trim() === "") {
      await record("SECTION_NOT_FOUND", sargs.notFoundDetail ?? null);
      return;
    }

    try {
      const raw = await sargs.extract(sargs.text);
      const confident = raw.filter((r) => r.confidence >= CONFIDENCE_FLOOR);
      const text = sargs.text;
      const verifyRow = sargs.verifyRow;
      let rows: TRow[];
      let droppedUnverified = 0;
      if (verifyRow !== undefined && confident.length > 0) {
        rows = confident.filter((r) => verifyRow(text, r));
        droppedUnverified = confident.length - rows.length;
      } else {
        rows = confident;
      }
      if (rows.length === 0) {
        const allDroppedUnverified =
          droppedUnverified > 0 && droppedUnverified === confident.length;
        const reason = allDroppedUnverified
          ? "UNVERIFIED_SOURCE_SPAN"
          : raw.length === 0
            ? "MODEL_EMPTY"
            : "LOW_CONFIDENCE_ALL";
        const detail = allDroppedUnverified
          ? (sargs.unverifiedAllDetail ?? sargs.lowConfidenceDetail).replace(
              /\$T/g,
              String(confident.length)
            )
          : raw.length === 0
            ? sargs.emptyDetail
            : sargs.lowConfidenceDetail;
        await record(reason, detail);
        return;
      }
      const wrote = await sargs.persist(rows);
      if (sargs.invalidWriteDetail !== undefined && wrote === 0) {
        await record("MODEL_INVALID_OUTPUT", sargs.invalidWriteDetail);
      } else {
        await deadLetters.markResolved(EXTRACTOR_ID, accession_number, sargs.sectionName);
      }
      if (droppedUnverified > 0 && sargs.unverifiedPartialDetail !== undefined) {
        await deadLetters.record({
          extractor_id: EXTRACTOR_ID,
          accession_number,
          section_name: `${sargs.sectionName}-partial`,
          reason_code: "UNVERIFIED_SOURCE_SPAN",
          detail: sargs.unverifiedPartialDetail
            .replace(/\$N/g, String(droppedUnverified))
            .replace(/\$T/g, String(confident.length)),
          failed_extractor_version: extractor_version,
          source_run_id: null,
        });
      }
    } catch (e) {
      await record("MODEL_INVALID_OUTPUT", (e instanceof Error ? e.message : String(e)).slice(0, 1024));
    }
  }

  // The entity sections feed a SECTION_NOT_FOUND with a `null` detail when the
  // text is undefined. `runSection` also treats a blank string as not-found,
  // but the original entity blocks only checked `=== undefined`. Section text
  // sourced directly from `byName` is never the empty string (the segmenter
  // emits non-empty section bodies), so the two checks coincide in practice.

  // --- Management ---
  await runSection({
    sectionName: S1_SECTIONS.MANAGEMENT,
    text: byName.get(S1_SECTIONS.MANAGEMENT),
    emptyDetail: "no people returned",
    lowConfidenceDetail: "all rows below confidence floor",
    extract: (text) => extractManagement(text, model),
    persist: async (rows) => {
      for (const r of rows) {
        const name = splitPersonName(r.full_name);
        const { observation_id } = await observer.observePerson({
          ...base,
          observation_index: idx++,
          source_filing_issuer_cik: cik,
          first_name: name.first,
          middle_name: name.middle,
          last_name: name.last,
          suffix: name.suffix,
          title: r.title,
          relationship: r.relationship ?? "s1:management",
          source_context: JSON.stringify({ relation: "s1:management" }),
        });
        await provenance.save({
          kind: "person",
          observation_id,
          confidence: r.confidence,
          source_span: r.source_span,
          section_name: S1_SECTIONS.MANAGEMENT,
          model_id,
          prompt_version: extractor_version,
          extra: null,
        });
      }
      return rows.length;
    },
  });

  // --- Beneficial ownership ---
  await runSection({
    sectionName: S1_SECTIONS.BENEFICIAL_OWNERSHIP,
    text: byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP),
    emptyDetail: "no owners returned",
    lowConfidenceDetail: "all rows below confidence floor",
    extract: (text) => extractBeneficialOwnership(text, model),
    persist: async (rows) => {
      for (const r of rows) {
        const observation_index = idx++;
        let observation_id: number;
        if (r.owner_kind === "person") {
          const name = splitPersonName(r.name);
          ({ observation_id } = await observer.observePerson({
            ...base,
            observation_index,
            source_filing_issuer_cik: cik,
            first_name: name.first,
            middle_name: name.middle,
            last_name: name.last,
            suffix: name.suffix,
            relationship: "s1:beneficial-owner",
            source_context: JSON.stringify({ relation: "s1:beneficial-owner" }),
          }));
        } else {
          ({ observation_id } = await observer.observeCompany({
            ...base,
            observation_index,
            name: r.name,
            source_context: JSON.stringify({ relation: "s1:beneficial-owner" }),
          }));
        }
        await ownershipRepo.save({
          accession_number,
          extractor_id: EXTRACTOR_ID,
          observation_index,
          owner_kind: r.owner_kind,
          observation_id,
          security_class: r.security_class,
          shares_owned: r.shares_owned,
          percent_owned: r.percent_owned,
          shares_offered: r.shares_offered,
          shares_after: r.shares_after,
          percent_after: r.percent_after,
          is_selling_stockholder: r.is_selling_stockholder,
          footnote: r.footnote,
        });
        await provenance.save({
          kind: r.owner_kind,
          observation_id,
          confidence: r.confidence,
          source_span: r.source_span,
          section_name: S1_SECTIONS.BENEFICIAL_OWNERSHIP,
          model_id,
          prompt_version: extractor_version,
          extra: null,
        });
      }
      return rows.length;
    },
  });

  // --- Related-party transactions ---
  await runSection({
    sectionName: S1_SECTIONS.RELATED_PARTY,
    text: byName.get(S1_SECTIONS.RELATED_PARTY),
    emptyDetail: "no parties returned",
    lowConfidenceDetail: "all rows below confidence floor",
    extract: (text) => extractRelatedParty(text, model),
    persist: async (rows) => {
      let txIndex = 0;
      for (const r of rows) {
        const observation_index = idx++;
        let observation_id: number;
        if (r.party_kind === "person") {
          const name = splitPersonName(r.name);
          ({ observation_id } = await observer.observePerson({
            ...base,
            observation_index,
            source_filing_issuer_cik: cik,
            first_name: name.first,
            middle_name: name.middle,
            last_name: name.last,
            suffix: name.suffix,
            relationship: "s1:related-party",
            source_context: JSON.stringify({ relation: "s1:related-party" }),
          }));
        } else {
          ({ observation_id } = await observer.observeCompany({
            ...base,
            observation_index,
            name: r.name,
            source_context: JSON.stringify({ relation: "s1:related-party" }),
          }));
        }
        await provenance.save({
          kind: r.party_kind,
          observation_id,
          confidence: r.confidence,
          source_span: r.source_span,
          section_name: S1_SECTIONS.RELATED_PARTY,
          model_id,
          prompt_version: extractor_version,
          extra: null,
        });
        for (const t of r.transactions) {
          await relatedRepo.save({
            accession_number,
            extractor_id: EXTRACTOR_ID,
            transaction_index: txIndex++,
            party_kind: r.party_kind,
            observation_id,
            counterparty: t.counterparty,
            nature: t.nature,
            amount: t.amount,
            period: t.period,
            footnote: t.footnote,
          });
        }
      }
      return rows.length;
    },
  });

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
          extractor_id: EXTRACTOR_ID,
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
          extractor_id: EXTRACTOR_ID,
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
          extractor_id: EXTRACTOR_ID,
          accession_number,
          exchange: (t.exchange ?? terms.exchange ?? "").trim(),
          ticker,
          cik,
          filing_date: args.filing_date,
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
        const observation_index = idx++;
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
          extractor_id: EXTRACTOR_ID,
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
          extractor_id: EXTRACTOR_ID,
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

  // --- SPAC sponsors (gated on deterministic classification) ---
  // Prefer the dedicated "The Sponsor" section when the segmenter found it; fall
  // back to the concatenated target sections (management / ownership /
  // related-party) when that heading is absent. The text is blank only when no
  // target heading matched at all, in which case we dead-letter SECTION_NOT_FOUND.
  // Pin TRow explicitly: the verifyRow callback's `r.source_span` access would
  // otherwise contextually anchor TRow to the bare `{ confidence: number }`
  // constraint and break inference for the persist callback below.
  type SpacSponsorRow = Awaited<ReturnType<typeof extractSpacSponsors>>[number];
  await runSection<SpacSponsorRow>({
    sectionName: "spac-sponsors",
    skip: !isSpac,
    text: byName.get(S1_SECTIONS.THE_SPONSOR) ?? [...byName.values()].join("\n\n"),
    notFoundDetail: "no section text available for sponsor extraction",
    emptyDetail: "no sponsors returned",
    lowConfidenceDetail: "all rows below confidence floor",
    invalidWriteDetail: "no sponsor rows had usable legal and common names",
    // v1.1.0: verify the LLM-returned source_span actually appears in the
    // section text we sent. The sponsor-section input may be the concatenation
    // of management/ownership/related-party text (when "The Sponsor" heading
    // is absent), so an LLM can hallucinate company names from director bios;
    // this gate stops unverified rows from being written as fact-claims keyed
    // to the issuer CIK.
    verifyRow: (text, r) => spanAppearsIn(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident sponsor rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident sponsor rows had source_span not present in section text",
    extract: (text) => extractSpacSponsors(text, model),
    persist: async (rows) => {
      let wrote = 0;
      for (const r of rows) {
        // A row whose legal or common name is blank (degenerate model output)
        // is skipped rather than allowed to throw inside the resolver and abort
        // every other valid sponsor in this filing.
        const legalName = r.legal_name?.trim() ?? "";
        const commonName = r.common_name?.trim() ?? "";
        if (legalName === "" || commonName === "") continue;
        const observation_index = idx++;
        const { observation_id, canonical_company_id } = await observer.observeCompany({
          ...base,
          observation_index,
          name: legalName,
          source_context: JSON.stringify({ relation: "s1:spac-sponsor" }),
        });
        await provenance.save({
          kind: "company",
          observation_id,
          confidence: r.confidence,
          source_span: r.source_span,
          section_name: "spac-sponsors",
          model_id,
          prompt_version: extractor_version,
          extra: null,
        });
        const sponsor_family_id = await sponsorFamilyResolver.resolve(commonName);
        await membershipRepo.record({
          resolver_version: activeSponsorFamilyVersion,
          canonical_company_id,
          canonical_sponsor_family_id: sponsor_family_id,
          seen_at: new Date().toISOString(),
        });
        await linkRepo.save({
          accession_number,
          extractor_id: EXTRACTOR_ID,
          observation_index,
          issuer_cik: cik,
          sponsor_canonical_company_id: canonical_company_id,
          sponsor_family_id,
          resolver_version: activeSponsorFamilyVersion,
        });
        wrote++;
      }
      return wrote;
    },
  });
}
