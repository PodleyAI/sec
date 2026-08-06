/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type IExecuteContext, type ModelConfig } from "workglow";
import { prefetchModel } from "../../../task/model/EnsureModelDownloadedTask";
import { CompanyObservationRepo } from "../../../storage/observation/CompanyObservationRepo";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { BeneficialOwnershipRepo } from "../../../storage/beneficial-ownership/BeneficialOwnershipRepo";
import { ExecutiveCompensationRepo } from "../../../storage/executive-compensation/ExecutiveCompensationRepo";
import { RelatedPartyTransactionRepo } from "../../../storage/related-party/RelatedPartyTransactionRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { RiskFactorRepo } from "../../../storage/risk-factor/RiskFactorRepo";
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
  extractExecutiveCompensation,
  extractManagement,
  extractRelatedParty,
  extractRiskFactors,
  extractSpacClassification,
  extractSpacProfile,
  extractSpacSponsors,
} from "./s1/sectionExtractors";
import type { ExecutiveCompensationRow } from "./s1/executiveCompensationSchema";
import { hasSummaryCompensationTable } from "./s1/compensationHeuristic";
import { MAX_RISK_FACTORS_CHARS } from "./s1/riskFactorChunks";
import type { RiskFactorRow } from "./s1/riskFactorSchema";
import { getRiskFactorsConfidenceFloor, getRiskFactorsModel } from "./s1/riskFactorsModel";
import type { SpacClassificationRow } from "./s1/spacClassifierSchema";
import { looksLikeBlankCheck } from "./s1/spacContentHeuristic";
import { getSpacClassifierConfidenceFloor, getSpacClassifierModel } from "./s1/spacClassifierModel";
import type { SpacProfileRow } from "./s1/spacProfileSchema";
import type { BeneficialOwnerRow, ManagementPersonRow, RelatedPartyRow } from "./s1/sectionSchemas";
import { makeRunSection } from "./s1/sectionRunner";
import { offeringSectionNames, runOfferingSections } from "./s1/offeringSections";
import { getS1Model, resolveModelId } from "./s1/s1Model";
import { splitPersonName } from "./s1/splitName";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

const EXTRACTOR_ID = "S-1";
/** Dead-letter section name for the risk-factor list. */
const RISK_FACTORS_SECTION = "risk-factors";
// Stays 1.0.0: there is no persisted data to re-extract, so the version-bump
// ceremony — which exists only to make old dead-letters retry-eligible after a
// prompt/schema change — is moot (and the runtime version is bootstrap-seeded
// to 1.0.0 regardless of this fallback). The prompt/schema has evolved
// (source_span verification, prompt-injection hardening, the SPAC "Prospectus
// Summary" profile section), but with a blank DB none of it needs a bump;
// revisit versioning once a populated database exists.
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";

/**
 * Convert a stated age (from the management section, relative to the filing
 * date) into a stable birth year. Returns null for a missing/implausible age or
 * an unparseable filing date, so a garbage model value never lands on the row.
 */
export function birthYearFromAge(age: number | null, filingDate: string): number | null {
  if (age == null || !Number.isFinite(age) || age < 18 || age > 120) return null;
  const filingYear = Number.parseInt(filingDate.slice(0, 4), 10);
  if (!Number.isFinite(filingYear) || filingYear < 1900 || filingYear > 2100) return null;
  const birthYear = filingYear - Math.trunc(age);
  // Keep within the PersonObservation.birth_year schema range [1900, 2100];
  // a very old age on an early filing could otherwise fall below 1900.
  return birthYear >= 1900 && birthYear <= 2100 ? birthYear : null;
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
  readonly context?: IExecuteContext;
}

export async function processFormS1(args: ProcessFormS1Args): Promise<void> {
  const { cik, accession_number, formS1 } = args;
  // A misconfigured/unregistered SEC_S1_MODEL must not discard the deterministic
  // work below (XBRL facts, issuer identity, the SPAC registration row). Resolve
  // to null on failure and dead-letter the AI sections, mirroring the PARSE_ERROR
  // containment further down (and the redemption 8-K path).
  let model: ModelConfig | null;
  let modelError: string | null = null;
  try {
    model = args.model ?? (await getS1Model());
  } catch (err) {
    model = null;
    modelError = err instanceof Error ? err.message : String(err);
  }
  const model_id = model ? resolveModelId(model) : null;
  // Fetch a local model's weights up front so the download's progress renders in
  // the CLI task UI before the (silent) per-section extraction begins.
  await prefetchModel(model_id, args.context);

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
  const compensationRepo = new ExecutiveCompensationRepo();
  const riskFactorRepo = new RiskFactorRepo();
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
  await compensationRepo.clear(accession_number);
  await riskFactorRepo.clear(accession_number);
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
  // Mutable: the AI content classifier below can upgrade a SIC-miscoded SPAC
  // from false → true after segmentation, before the registration/profile/
  // offering blocks read it.
  let isSpac = headerSic === 6770;
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
  // Shared base for the registration write; the success path spreads the
  // AI-extracted profile fields onto it, the parse-failure path uses it as-is.
  const baseReg = {
    cik,
    accession_number,
    filing_date: args.filing_date,
    form: args.form,
    primary_document: null,
    spac_name: spacName,
    spac_sic: headerSic,
  };

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

  // Model unavailable: the deterministic work above (XBRL, issuer observation,
  // SPAC classification) has persisted. Record the base SPAC registration row so
  // the SPAC is still tracked — and its de-SPAC 8-K milestones can attach — then
  // dead-letter every AI section so a retry resolves them once a model exists.
  if (!model) {
    if (isSpac) await new SpacReportWriter().recordRegistration(baseReg);
    const sectionNames: readonly string[] = [
      S1_SECTIONS.MANAGEMENT,
      S1_SECTIONS.BENEFICIAL_OWNERSHIP,
      S1_SECTIONS.RELATED_PARTY,
      // Recorded unconditionally: whether the filing even has a Summary
      // Compensation Table is only knowable after segmentation, which these
      // paths never reached. A retry that finds none resolves the entry.
      S1_SECTIONS.EXECUTIVE_COMPENSATION,
      RISK_FACTORS_SECTION,
      ...offeringSectionNames(isSpac),
      ...(isSpac ? ["spac-profile", "spac-sponsors"] : []),
      // A SIC-miscoded, blank-check-looking non-SPAC filing gets a
      // spac-classification dead-letter so a retry runs the AI classifier once a
      // model is available. Gated on the cheap heuristic over the raw HTML so an
      // ordinary S-1 does not flood the worklist.
      ...(!isSpac && looksLikeBlankCheck(formS1.html) ? ["spac-classification"] : []),
    ];
    for (const section of sectionNames) {
      await recordFail(section, "MODEL_RESOLUTION_ERROR", modelError);
    }
    return;
  }

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
      await new SpacReportWriter().recordRegistration(baseReg);
    }
    // Dead-letter each section under the name its runSection ceremony uses
    // (entity sections use segment names; the derived sections use literal
    // names) so a later successful retry markResolves every entry — letters
    // recorded under segmenter-only names would stay pending forever.
    const sectionNames: readonly string[] = [
      S1_SECTIONS.MANAGEMENT,
      S1_SECTIONS.BENEFICIAL_OWNERSHIP,
      S1_SECTIONS.RELATED_PARTY,
      // Recorded unconditionally: whether the filing even has a Summary
      // Compensation Table is only knowable after segmentation, which these
      // paths never reached. A retry that finds none resolves the entry.
      S1_SECTIONS.EXECUTIVE_COMPENSATION,
      RISK_FACTORS_SECTION,
      ...offeringSectionNames(isSpac),
      ...(isSpac ? ["spac-profile", "spac-sponsors"] : []),
      ...(!isSpac && looksLikeBlankCheck(formS1.html) ? ["spac-classification"] : []),
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

  // --- AI SPAC content classification (SIC-miscoded upgrade path) ---
  // The deterministic classifier above only flags SIC == 6770. A SPAC filed
  // under a miscoded/absent SIC would be missed, so — when the filing was NOT
  // already classified as a SPAC and its summary prose is blank-check-like (the
  // cheap heuristic keeps the AI call rare, reserved for plausibly miscoded
  // filings) — run an AI content classifier behind the `classifier_source =
  // "ai"` seam. A confident SPAC verdict upgrades the local flag AND overwrites
  // the classification row, so the registration / profile / offering blocks
  // below treat it as a known SPAC and its de-SPAC 8-K milestones can attach.
  if (!isSpac) {
    const classifyText = byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY) ?? "";
    if (!looksLikeBlankCheck(classifyText)) {
      // The error paths above dead-letter spac-classification on the looser
      // raw-HTML heuristic, so a filing can be dead-lettered for a classification
      // this narrower summary-prose gate then declines to run. Resolve the entry
      // instead of leaving it pending forever on the version-gated retry
      // worklist, where every sweep would re-bill the filing's full extraction.
      // (markResolved no-ops when no entry exists.)
      await deadLetters.markResolved(EXTRACTOR_ID, accession_number, "spac-classification");
    } else {
      let classifierModel: ModelConfig | null = null;
      let classifierError: string | null = null;
      try {
        classifierModel = args.model ?? (await getSpacClassifierModel());
      } catch (err) {
        classifierError = err instanceof Error ? err.message : String(err);
      }
      if (classifierModel === null) {
        await recordFail("spac-classification", "MODEL_RESOLUTION_ERROR", classifierError);
      } else {
        const classifierModelResolved = classifierModel;
        const classifierHolder = { upgraded: false };
        const classifierRunSection = makeRunSection({
          deadLetters,
          extractor_id: EXTRACTOR_ID,
          extractor_version,
          accession_number,
          confidenceFloor: getSpacClassifierConfidenceFloor(),
        });
        await classifierRunSection<SpacClassificationRow>({
          sectionName: "spac-classification",
          text: classifyText,
          emptyDetail: "not classified as a SPAC",
          lowConfidenceDetail: "SPAC classification below confidence floor",
          verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
          unverifiedAllDetail:
            "the confident SPAC classification had source_span not present in section text",
          extract: async (text) => {
            const c = await extractSpacClassification(text, classifierModelResolved, args.context);
            return c === null ? [] : [c];
          },
          persist: async () => {
            classifierHolder.upgraded = true;
            return 1;
          },
        });
        if (classifierHolder.upgraded) {
          isSpac = true;
          await new S1ClassificationRepo().save({
            extractor_id: EXTRACTOR_ID,
            accession_number,
            cik,
            sic: headerSic,
            sic_description: formS1.header?.sicDescription ?? null,
            is_spac: true,
            classifier_source: "ai",
            created_at: new Date().toISOString(),
          });
        } else {
          // "Not a miscoded SPAC" is the expected outcome — auto-resolve the
          // MODEL_EMPTY entry so a confident negative doesn't linger on the
          // version-gated retry worklist (mirrors the LOI detector). A genuine
          // problem (LOW_CONFIDENCE_ALL / UNVERIFIED_SOURCE_SPAN / NONCE_MISMATCH)
          // stays pending.
          const entry = await deadLetters.get(
            EXTRACTOR_ID,
            accession_number,
            "spac-classification"
          );
          if (entry?.reason_code === "MODEL_EMPTY") {
            await deadLetters.markResolved(EXTRACTOR_ID, accession_number, "spac-classification");
          }
        }
      }
    }
  }

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
      unverifiedAllDetail: "the confident SPAC profile had source_span not present in section text",
      extract: async (text) => {
        const p = await extractSpacProfile(text, model, args.context);
        return p === null ? [] : [p];
      },
      persist: async (rows) => {
        profileHolder.row = rows[0];
        return 1;
      },
    });

    const profile = profileHolder.row;
    await new SpacReportWriter().recordRegistration({
      ...baseReg,
      // JSON-encode the string[] facets (mirrors spac_tickers: empty array ->
      // null, not "[]", so a later filing that restates no tags does not clobber
      // previously-extracted focus under the rollup's non-null-wins merge).
      focus: profile && profile.focus.length > 0 ? JSON.stringify(profile.focus) : null,
      focus_location:
        profile && profile.focus_location.length > 0
          ? JSON.stringify(profile.focus_location)
          : null,
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
    extract: (text) => extractManagement(text, model, args.context),
    persist: async (rows, meta) => {
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
          titles: r.titles,
          relationship: r.relationship ?? "s1:management",
          filing_date: args.filing_date,
          role_scope: "s1:management",
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
      // The management section names the COMPLETE roster of officers and
      // directors, so an open role this filing no longer asserts has ended —
      // but only when every extracted row survived filtering: a person dropped
      // by the confidence floor or span verification is still named in the
      // filing, and closing their role from the partial subset would record a
      // false departure.
      if (meta.complete) {
        await observer.closeUnassertedPersonRoles({
          accession_number,
          extractor_id: EXTRACTOR_ID,
          role_scope: "s1:management",
          company_cik: cik,
          filing_date: args.filing_date,
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
    extract: (text) => extractBeneficialOwnership(text, model, args.context),
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
    extract: (text) => extractRelatedParty(text, model, args.context),
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

  // --- Executive compensation (the Item 402 Summary Compensation Table) ---
  // Gated on a deterministic check for the table's mandated captions, which
  // keeps the section cheap: a blank-check company's compensation section is a
  // single sentence stating that no officer or director has been paid. That is
  // not a failure, so it costs no AI call and leaves no permanent dead letter —
  // and resolving on the skip keeps a filing that a previous version
  // dead-lettered from lingering on the version-gated retry worklist
  // (markResolved no-ops when none exists).
  //
  // No matched section at all is a different outcome, and is recorded as
  // SECTION_NOT_FOUND like every other section: the heading patterns are the
  // only thing standing between a real Item 402 disclosure and this extractor,
  // so a filing whose compensation section is headed in a spelling they miss
  // (e.g. "Compensation Discussion and Analysis") must show up as a coverage
  // hole to be triaged, not as a clean run that found nothing.
  const compensationText = byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION);
  if (compensationText === undefined || compensationText.trim() === "") {
    await recordFail(
      S1_SECTIONS.EXECUTIVE_COMPENSATION,
      "SECTION_NOT_FOUND",
      "no executive compensation section text"
    );
  } else if (!hasSummaryCompensationTable(compensationText)) {
    await recordOk(S1_SECTIONS.EXECUTIVE_COMPENSATION);
  } else {
    await runSection<ExecutiveCompensationRow>({
      sectionName: S1_SECTIONS.EXECUTIVE_COMPENSATION,
      text: compensationText,
      emptyDetail: "no compensation rows returned",
      lowConfidenceDetail: "all rows below confidence floor",
      verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
      unverifiedAllDetail:
        "all $T confident compensation rows had source_span not present in section text",
      unverifiedPartialDetail:
        "$N of $T confident compensation rows had source_span not present in section text",
      extract: (text) => extractExecutiveCompensation(text, model, args.context),
      persist: async (rows) => {
        // An officer shown for two fiscal years is two table rows but ONE
        // mention of that person, so the observation is minted once and reused;
        // the row key is positional and independent of it.
        const observed = new Map<string, number>();
        let row_index = 0;
        for (const r of rows) {
          const personKey = r.person_name.trim().toLowerCase();
          let observation_id = observed.get(personKey);
          if (observation_id === undefined) {
            const name = splitPersonName(r.person_name);
            ({ observation_id } = await observer.observePerson({
              ...base,
              observation_index: idx++,
              source_filing_issuer_cik: cik,
              first_name: name.first,
              middle_name: name.middle,
              last_name: name.last,
              suffix: name.suffix,
              titles: r.principal_position === null ? [] : [r.principal_position],
              relationship: "s1:named-executive-officer",
              // No role_scope, so this claim records observation titles but mints
              // no `person_role` tenure: the compensation table names only the
              // named executive officers, a strict subset of the management
              // roster that the `s1:management` population already dates.
              source_context: JSON.stringify({ relation: "s1:executive-compensation" }),
            }));
            observed.set(personKey, observation_id);
            await provenance.save({
              kind: "person",
              observation_id,
              confidence: r.confidence,
              source_span: boundSourceSpan(r.source_span),
              section_name: S1_SECTIONS.EXECUTIVE_COMPENSATION,
              model_id,
              prompt_version: extractor_version,
              extra: null,
            });
          }
          await compensationRepo.save({
            accession_number,
            extractor_id: EXTRACTOR_ID,
            row_index: row_index++,
            observation_id,
            principal_position: r.principal_position,
            fiscal_year: r.fiscal_year,
            salary: r.salary,
            bonus: r.bonus,
            stock_awards: r.stock_awards,
            option_awards: r.option_awards,
            non_equity_incentive: r.non_equity_incentive,
            pension_and_nqdc: r.pension_and_nqdc,
            all_other_compensation: r.all_other_compensation,
            total: r.total,
            footnote: r.footnote,
          });
        }
        return rows.length;
      },
    });
  }

  // --- Risk factors (the Item 105 list) ---
  // The largest section in a prospectus, and the only one whose row count runs
  // to dozens, so extraction is chunked (see `chunkRiskFactorText`) and carries
  // its own model / floor knobs; the rest of the ceremony is the standard one.
  const riskText = byName.get(S1_SECTIONS.RISK_FACTORS);
  if (riskText === undefined || riskText.trim() === "") {
    await recordFail(RISK_FACTORS_SECTION, "SECTION_NOT_FOUND", "no risk factors section text");
  } else if (riskText.length > MAX_RISK_FACTORS_CHARS) {
    // A section this large means the prospectus body collapsed under one
    // heading rather than that the filer disclosed that many risks; extracting
    // it would fan out into dozens of calls over prose that is mostly not risk
    // disclosure. Record it for triage instead of paying for it.
    await recordFail(
      RISK_FACTORS_SECTION,
      "OVERSIZED_INPUT",
      `risk factors section of ${riskText.length} chars exceeds the ` +
        `${MAX_RISK_FACTORS_CHARS} char cap`
    );
  } else {
    let riskModel: ModelConfig | null = null;
    let riskModelError: string | null = null;
    try {
      riskModel = args.model ?? (await getRiskFactorsModel());
    } catch (err) {
      riskModelError = err instanceof Error ? err.message : String(err);
    }
    if (riskModel === null) {
      await recordFail(RISK_FACTORS_SECTION, "MODEL_RESOLUTION_ERROR", riskModelError);
    } else {
      const riskModelResolved = riskModel;
      const riskRunSection = makeRunSection({
        deadLetters,
        extractor_id: EXTRACTOR_ID,
        extractor_version,
        accession_number,
        confidenceFloor: getRiskFactorsConfidenceFloor(),
      });
      await riskRunSection<RiskFactorRow>({
        sectionName: RISK_FACTORS_SECTION,
        text: riskText,
        emptyDetail: "no risk factors returned",
        lowConfidenceDetail: "all rows below confidence floor",
        invalidWriteDetail: "no risk factor rows carried a usable headline",
        // Prompt-injection backstop, applied to the headline as well as the
        // span: the caption IS the row's payload, so a paraphrased or invented
        // risk is worthless even when the span it cites verifies. Verifying it
        // also bounds the stored headline (the verifier rejects anything over
        // 1000 raw chars) well inside the column's declared width.
        verifyRow: (text, r) =>
          verifyRowSpan(text, r.source_span) && verifyRowSpan(text, r.headline),
        unverifiedAllDetail:
          "all $T confident risk factor rows had headline/source_span not present in section text",
        unverifiedPartialDetail:
          "$N of $T confident risk factor rows had headline/source_span not present in section text",
        extract: (text) => extractRiskFactors(text, riskModelResolved, args.context),
        persist: async (rows) => {
          const now = new Date().toISOString();
          let riskIndex = 0;
          for (const r of rows) {
            const headline = r.headline?.trim() ?? "";
            if (headline === "") continue;
            const category = r.category?.trim() ?? "";
            await riskFactorRepo.save({
              extractor_id: EXTRACTOR_ID,
              accession_number,
              risk_index: riskIndex++,
              cik,
              // An over-long category is an annotation, not the row's identity:
              // null it rather than fail the write (and the whole section).
              category: category === "" || category.length > 512 ? null : category,
              headline,
              confidence: r.confidence,
              source_span: boundSourceSpan(r.source_span),
              created_at: now,
            });
          }
          return riskIndex;
        },
      });
    }
  }

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
    context: args.context,
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
    // The fallback concatenation excludes the risk-factor section: it is the
    // largest section in the filing and names no sponsors, so folding it in
    // would multiply this prompt for prose the extractor has to ignore.
    text:
      byName.get(S1_SECTIONS.THE_SPONSOR) ??
      [...byName.entries()]
        .filter(([name]) => name !== S1_SECTIONS.RISK_FACTORS)
        .map(([, sectionText]) => sectionText)
        .join("\n\n"),
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
    extract: (text) => extractSpacSponsors(text, model, args.context),
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
