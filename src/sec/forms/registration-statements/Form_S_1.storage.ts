/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type ModelConfig } from "workglow";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
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
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import type { FormS1Parsed } from "./Form_S_1";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { S1_SECTIONS, type S1SectionName } from "./s1/DocumentSegmenter";
import { boundSourceSpan, verifyRowSpan } from "./s1/verifySourceSpan";
import {
  extractBeneficialOwnership,
  extractManagement,
  extractRelatedParty,
  extractSpacProfile,
  extractSpacSponsors,
} from "./s1/sectionExtractors";
import type { SpacProfileRow } from "./s1/spacProfileSchema";
import type {
  BeneficialOwnerRow,
  ManagementPersonRow,
  RelatedPartyRow,
} from "./s1/sectionSchemas";
import { makeRunSection } from "./s1/sectionRunner";
import { OFFERING_SECTION_NAMES, runOfferingSections } from "./s1/offeringSections";
import { getS1Model, resolveModelId } from "./s1/s1Model";
import { splitPersonName } from "./s1/splitName";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

const EXTRACTOR_ID = "S-1";
// v1.1.0: SPAC sponsor extraction now requires the LLM-returned source_span to
// appear verbatim (after light normalization) in the section text before a
// canonical sponsor row is persisted.
// v1.2.0: prompt-injection hardening — UNTRUSTED_FILER_DOCUMENT XML wrap +
// preamble in every section prompt, plus verifyRow source_span verification
// on management / beneficial-ownership / related-party / offering-terms /
// underwriters / use-of-proceeds (previously only SPAC sponsors). The wrap
// changes the prompt the model sees, so confidence calibration drifts
// downstream; treat as a fresh dev cycle.
// v1.3.0: deepened the injection seal — the fence tag now carries a per-call
// random nonce, the section body is HTML-entity-decoded + NFKC-normalized +
// zero-width-stripped before defang so obfuscated fence-tag lookalikes are
// caught, and stored source_span columns are capped at the raw-byte level
// to deny adversarial spans unbounded storage.
// v1.4.0: new SPAC "Prospectus Summary" profile section (focus / focus_location
// / description / team / url_spac) merged onto the spac report row.
const DEFAULT_EXTRACTOR_VERSION = "1.4.0";

/**
 * Convert a stated age (from the management section, relative to the filing
 * date) into a stable birth year. Returns null for a missing/implausible age or
 * an unparseable filing date, so a garbage model value never lands on the row.
 */
export function birthYearFromAge(age: number | null, filingDate: string): number | null {
  if (age == null || !Number.isFinite(age) || age < 18 || age > 120) return null;
  const filingYear = Number.parseInt(filingDate.slice(0, 4), 10);
  if (!Number.isFinite(filingYear) || filingYear < 1900 || filingYear > 2100) return null;
  return filingYear - Math.trunc(age);
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
  const model_id = resolveModelId(model);

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

  const observer = buildEntityObserver({
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

  // Deterministic iXBRL/XBRL pass: persists every tagged fact and recovers dei
  // cover-page attributes that upgrade the issuer observation below. Contained
  // failures only — an untagged or malformed filing proceeds as before.
  const xbrl = await extractAndStoreXbrl({
    cik,
    accession_number,
    html: formS1.html,
    xbrlInstanceXml: formS1.xbrlInstanceXml,
    feeExhibitHtml: formS1.feeExhibitHtml,
  });

  await observer.observeCompany({
    ...base,
    observation_index: idx++,
    cik,
    name: xbrl.name,
    jurisdiction: xbrl.jurisdiction,
    address_id: xbrl.address_id,
    international_number: xbrl.international_number,
    source_context: JSON.stringify(
      xbrl.hasIssuerAttributes
        ? { relation: "s1:issuer", attributes_source: "xbrl-dei" }
        : { relation: "s1:issuer" }
    ),
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

  // Consolidated SPAC report: the registration event + row is recorded below,
  // AFTER segmentation, so the AI-extracted profile (focus / description / team
  // / website) can be merged onto the same registration write. The base row is
  // still created on the parse-failure path so a SPAC whose HTML fails to
  // convert is not lost.
  const spacName = xbrl.name ?? formS1.header?.companyName ?? null;

  const recordFail = (section: string, reason: string, detail: string | null) =>
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
    // The HTML failed to convert, so no profile can be extracted — still create
    // the base SPAC row (registration event + name/SIC) so the SPAC is tracked.
    if (isSpac) {
      await new SpacReportWriter().recordRegistration({
        cik,
        accession_number,
        filing_date: args.filing_date,
        form: args.form,
        primary_document: null,
        spac_name: spacName,
        spac_sic: headerSic,
      });
    }
    // Dead-letter each section under the name its runSection ceremony uses
    // (entity sections use segment names; the derived sections use literal
    // names) so a later successful retry markResolves every entry — letters
    // recorded under segmenter-only names would stay pending forever.
    const sectionNames: readonly string[] = [
      S1_SECTIONS.MANAGEMENT,
      S1_SECTIONS.BENEFICIAL_OWNERSHIP,
      S1_SECTIONS.RELATED_PARTY,
      ...OFFERING_SECTION_NAMES,
      ...(isSpac ? ["spac-profile", "spac-sponsors"] : []),
    ];
    for (const section of sectionNames) {
      await recordFail(section, "PARSE_ERROR", detail);
    }
    return;
  }
  const recordOk = (section: S1SectionName) =>
    deadLetters.markResolved(EXTRACTOR_ID, accession_number, section);

  const runSection = makeRunSection({
    deadLetters,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    accession_number,
  });

  // The entity sections feed a SECTION_NOT_FOUND with a `null` detail when the
  // text is undefined. `runSection` also treats a blank string as not-found,
  // but the original entity blocks only checked `=== undefined`. Section text
  // sourced directly from `byName` is never the empty string (the segmenter
  // emits non-empty section bodies), so the two checks coincide in practice.

  // --- SPAC profile (gated) → registration event + row ---
  // Runs before the base registration write so the AI-extracted focus /
  // description / team / website ride onto the same `recordRegistration` patch.
  // Extraction is best-effort: a missing summary section or low-confidence
  // result dead-letters `spac-profile` and leaves the row's narrative null,
  // while still recording the registration event below.
  // Holder (not a bare `let`) so the captured value keeps its declared type at
  // the read site below — a `let` assigned only inside the persist closure gets
  // pinned to its `null` initializer by TS control-flow analysis.
  const profileHolder: { row: SpacProfileRow | null } = { row: null };
  if (isSpac) {
    await runSection<SpacProfileRow>({
      sectionName: "spac-profile",
      text: byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY),
      notFoundDetail: "no prospectus summary / business section text",
      emptyDetail: "no SPAC profile returned",
      lowConfidenceDetail: "profile below confidence floor",
      verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
      unverifiedAllDetail:
        "the confident SPAC profile had source_span not present in section text",
      extract: async (text) => {
        const p = await extractSpacProfile(text, model);
        return p === null ? [] : [p];
      },
      persist: async (rows) => {
        profileHolder.row = rows[0];
        return 1;
      },
    });

    const profile = profileHolder.row;
    await new SpacReportWriter().recordRegistration({
      cik,
      accession_number,
      filing_date: args.filing_date,
      form: args.form,
      primary_document: null,
      spac_name: spacName,
      spac_sic: headerSic,
      // JSON-encode the string[] facets (mirrors spac_tickers); leave null when
      // extraction produced no profile so the rollup preserves prior values.
      focus: profile ? JSON.stringify(profile.focus) : null,
      focus_location: profile ? JSON.stringify(profile.focus_location) : null,
      description: profile?.description ?? null,
      team: profile?.team ?? null,
      url_spac: profile?.url_spac ?? null,
    });
  }

  // --- Management ---
  await runSection<ManagementPersonRow>({
    sectionName: S1_SECTIONS.MANAGEMENT,
    text: byName.get(S1_SECTIONS.MANAGEMENT),
    emptyDetail: "no people returned",
    lowConfidenceDetail: "all rows below confidence floor",
    // Prompt-injection backstop: a filer can plant adversarial prose in the
    // section body; this gate refuses to persist any row whose source_span
    // is not a verbatim substring of the text we actually sent the model.
    verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident management rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident management rows had source_span not present in section text",
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
          // Store birth_year (not age) so present age stays recomputable; a
          // stated age is relative to the filing date.
          birth_year: birthYearFromAge(r.age, args.filing_date),
          bio: r.bio,
          source_context: JSON.stringify({ relation: "s1:management" }),
        });
        await provenance.save({
          kind: "person",
          observation_id,
          confidence: r.confidence,
          source_span: boundSourceSpan(r.source_span),
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
  await runSection<BeneficialOwnerRow>({
    sectionName: S1_SECTIONS.BENEFICIAL_OWNERSHIP,
    text: byName.get(S1_SECTIONS.BENEFICIAL_OWNERSHIP),
    emptyDetail: "no owners returned",
    lowConfidenceDetail: "all rows below confidence floor",
    verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident ownership rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident ownership rows had source_span not present in section text",
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
          source_span: boundSourceSpan(r.source_span),
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
  await runSection<RelatedPartyRow>({
    sectionName: S1_SECTIONS.RELATED_PARTY,
    text: byName.get(S1_SECTIONS.RELATED_PARTY),
    emptyDetail: "no parties returned",
    lowConfidenceDetail: "all rows below confidence floor",
    verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident related-party rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident related-party rows had source_span not present in section text",
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
          source_span: boundSourceSpan(r.source_span),
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

  await runOfferingSections({
    runSection,
    observer,
    provenance,
    nextIndex: () => idx++,
    accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    cik,
    filing_date: args.filing_date,
    isSpac,
    model,
    model_id,
    activeUnderwriterFamilyVersion,
    byName,
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
    verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
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
          source_span: boundSourceSpan(r.source_span),
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
