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
import type { FormS1Parsed } from "./Form_S_1";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { S1_SECTIONS, type S1SectionName } from "./s1/DocumentSegmenter";
import {
  extractBeneficialOwnership,
  extractManagement,
  extractRelatedParty,
  extractSpacSponsors,
} from "./s1/sectionExtractors";
import { getS1Model } from "./s1/s1Model";
import { splitPersonName } from "./s1/splitName";

const EXTRACTOR_ID = "S-1";
const RAW_CONFIDENCE_FLOOR = Number(process.env.SEC_S1_CONFIDENCE_FLOOR ?? "0");
// A non-numeric SEC_S1_CONFIDENCE_FLOOR would be NaN, and `confidence >= NaN` is
// always false — silently dropping every row. Fall back to 0 (no floor).
const CONFIDENCE_FLOOR = Number.isFinite(RAW_CONFIDENCE_FLOOR) ? RAW_CONFIDENCE_FLOOR : 0;

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
  const [extractorSlot, personSlot, companySlot, sponsorFamilySlot] = await Promise.all([
    getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID),
    getActiveSlot(versionRegistry, "resolver", "person"),
    getActiveSlot(versionRegistry, "resolver", "company"),
    getActiveSlot(versionRegistry, "resolver", "sponsor-family"),
  ]);
  const extractor_version = extractorSlot?.semver ?? "1.0.0";
  const activeResolverPersonVersion = personSlot?.semver ?? "1.0.0";
  const activeResolverCompanyVersion = companySlot?.semver ?? "1.0.0";
  const activeSponsorFamilyVersion = sponsorFamilySlot?.semver ?? "1.0.0";

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

  await ownershipRepo.clear(accession_number);
  await relatedRepo.clear(accession_number);
  await linkRepo.clear(accession_number);

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

  // --- Management ---
  const mgmt = byName.get(S1_SECTIONS.MANAGEMENT);
  if (mgmt === undefined) {
    await recordFail(S1_SECTIONS.MANAGEMENT, "SECTION_NOT_FOUND", null);
  } else {
    try {
      const raw = await extractManagement(mgmt, model);
      const rows = raw.filter((r) => r.confidence >= CONFIDENCE_FLOOR);
      if (rows.length === 0) {
        await recordFail(
          S1_SECTIONS.MANAGEMENT,
          raw.length === 0 ? "MODEL_EMPTY" : "LOW_CONFIDENCE_ALL",
          raw.length === 0 ? "no people returned" : "all rows below confidence floor"
        );
      } else {
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
        await recordOk(S1_SECTIONS.MANAGEMENT);
      }
    } catch (e) {
      await recordFail(
        S1_SECTIONS.MANAGEMENT,
        "MODEL_INVALID_OUTPUT",
        (e as Error).message.slice(0, 1024)
      );
    }
  }

  // --- Beneficial ownership ---
  const own = byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP);
  if (own === undefined) {
    await recordFail(S1_SECTIONS.BENEFICIAL_OWNERSHIP, "SECTION_NOT_FOUND", null);
  } else {
    try {
      const raw = await extractBeneficialOwnership(own, model);
      const rows = raw.filter((r) => r.confidence >= CONFIDENCE_FLOOR);
      if (rows.length === 0) {
        await recordFail(
          S1_SECTIONS.BENEFICIAL_OWNERSHIP,
          raw.length === 0 ? "MODEL_EMPTY" : "LOW_CONFIDENCE_ALL",
          raw.length === 0 ? "no owners returned" : "all rows below confidence floor"
        );
      } else {
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
        await recordOk(S1_SECTIONS.BENEFICIAL_OWNERSHIP);
      }
    } catch (e) {
      await recordFail(
        S1_SECTIONS.BENEFICIAL_OWNERSHIP,
        "MODEL_INVALID_OUTPUT",
        (e as Error).message.slice(0, 1024)
      );
    }
  }

  // --- Related-party transactions ---
  const rel = byName.get(S1_SECTIONS.RELATED_PARTY);
  if (rel === undefined) {
    await recordFail(S1_SECTIONS.RELATED_PARTY, "SECTION_NOT_FOUND", null);
  } else {
    try {
      const raw = await extractRelatedParty(rel, model);
      const rows = raw.filter((r) => r.confidence >= CONFIDENCE_FLOOR);
      if (rows.length === 0) {
        await recordFail(
          S1_SECTIONS.RELATED_PARTY,
          raw.length === 0 ? "MODEL_EMPTY" : "LOW_CONFIDENCE_ALL",
          raw.length === 0 ? "no parties returned" : "all rows below confidence floor"
        );
      } else {
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
        await recordOk(S1_SECTIONS.RELATED_PARTY);
      }
    } catch (e) {
      await recordFail(
        S1_SECTIONS.RELATED_PARTY,
        "MODEL_INVALID_OUTPUT",
        (e as Error).message.slice(0, 1024)
      );
    }
  }

  // --- SPAC sponsors (gated on deterministic classification) ---
  if (isSpac) {
    // v1 strategy: sponsor names are not under a single canonical heading, so we
    // run the extractor over the concatenated text of the target sections we
    // already segmented (management / ownership / related-party) rather than
    // adding a dedicated segmenter section. `byName` is empty only when no target
    // heading matched, in which case there is no text to extract from and we
    // dead-letter the sponsor step as SECTION_NOT_FOUND. A future spec may add a
    // focused "The Sponsor" section to the segmenter (see design doc Future work).
    const sponsorText = [...byName.values()].join("\n\n");
    if (sponsorText.trim() === "") {
      await deadLetters.record({
        extractor_id: EXTRACTOR_ID,
        accession_number,
        section_name: "spac-sponsors",
        reason_code: "SECTION_NOT_FOUND",
        detail: "no section text available for sponsor extraction",
        failed_extractor_version: extractor_version,
        source_run_id: null,
      });
    } else {
      try {
        const raw = await extractSpacSponsors(sponsorText, model);
        const rows = raw.filter((r) => r.confidence >= CONFIDENCE_FLOOR);
        if (rows.length === 0) {
          await deadLetters.record({
            extractor_id: EXTRACTOR_ID,
            accession_number,
            section_name: "spac-sponsors",
            reason_code: raw.length === 0 ? "MODEL_EMPTY" : "LOW_CONFIDENCE_ALL",
            detail: raw.length === 0 ? "no sponsors returned" : "all rows below confidence floor",
            failed_extractor_version: extractor_version,
            source_run_id: null,
          });
        } else {
          for (const r of rows) {
            const observation_index = idx++;
            const { observation_id, canonical_company_id } = await observer.observeCompany({
              ...base,
              observation_index,
              name: r.legal_name,
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
            const sponsor_family_id = await sponsorFamilyResolver.resolve(r.common_name);
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
          }
          await deadLetters.markResolved(EXTRACTOR_ID, accession_number, "spac-sponsors");
        }
      } catch (e) {
        await deadLetters.record({
          extractor_id: EXTRACTOR_ID,
          accession_number,
          section_name: "spac-sponsors",
          reason_code: "MODEL_INVALID_OUTPUT",
          detail: (e as Error).message.slice(0, 1024),
          failed_extractor_version: extractor_version,
          source_run_id: null,
        });
      }
    }
  }
}
