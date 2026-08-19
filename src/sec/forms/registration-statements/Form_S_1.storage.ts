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
import { RelatedPartyTransactionSchema } from "../../../storage/related-party/RelatedPartyTransactionSchema";
import { assertWithinDeclaredBounds } from "../../../util/declaredBounds";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../../storage/dead-letter/ExtractionDeadLetterSchema";
import { RiskFactorRepo } from "../../../storage/risk-factor/RiskFactorRepo";
import { S1ClassificationRepo } from "../../../storage/classification/S1ClassificationRepo";
import { CanonicalSponsorFamilyRepo } from "../../../storage/canonical/CanonicalSponsorFamilyRepo";
import { CanonicalSponsorFamilyAliasRepo } from "../../../storage/canonical/CanonicalSponsorFamilyAliasRepo";
import { SponsorFamilyResolver } from "../../../resolver/SponsorFamilyResolver";
import { SponsorFamilyMembershipRepo } from "../../../storage/canonical/SponsorFamilyMembershipRepo";
import { SpacSponsorLinkRepo } from "../../../storage/canonical/SpacSponsorLinkRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import type { FormS1Parsed } from "./Form_S_1";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { SECTIONLESS_REGISTRATION_FORMS } from "../../../storage/versioning/extractorIds";
import { S1_SECTIONS, type S1SectionName } from "./s1/DocumentSegmenter";
import { boundSourceSpan, classifySpan, isElided, worstVerdict } from "./s1/verifySourceSpan";
import {
  extractBeneficialOwnership,
  extractExecutiveCompensation,
  extractManagement,
  extractRelatedParty,
  isCollectivePartyName,
  extractRiskFactors,
  extractSpacClassification,
  extractSpacProfile,
  extractSpacSponsors,
} from "./s1/sectionExtractors";
import type { ExecutiveCompensationRow } from "./s1/executiveCompensationSchema";
import { hasSummaryCompensationTable } from "./s1/compensationHeuristic";
import { parseSummaryCompensationTable } from "./s1/parseSummaryCompensationTable";
import { parseBeneficialOwnership } from "./s1/parseBeneficialOwnership";
import { parseManagementRoster } from "./s1/parseManagementRoster";
import { parseRelatedPartyTables } from "./s1/parseRelatedPartyTables";
import { parseSpacSponsors } from "./s1/parseSpacSponsors";
import { parseSpacProfile } from "./s1/parseSpacProfile";
import { parseSpacClassification } from "./s1/parseSpacClassification";
import { DETERMINISTIC_MODEL_ID } from "./s1/parseOfferingTables";
import { looksLikePartIIOnlyAmendment } from "./s1/partIIOnlyAmendment";
import { issuerHasCombinationListing } from "./s1/newcoListing";
import { MAX_RISK_FACTORS_CHARS } from "./s1/riskFactorChunks";
import { isCompanyFamilyPrefixEcho } from "../../../storage/company/CompanyFamilyName";
import { normalizeFamilyName } from "../../../resolver/FamilyResolver";
import { isUnnamedCompanyName } from "../../../storage/company/CompanyNormalization";
import {
  parentClauseSourceContext,
  splitParentClause,
} from "../../../storage/company/splitParentClause";
import type { RiskFactorRow } from "./s1/riskFactorSchema";
import { getRiskFactorsConfidenceFloor, getRiskFactorsModels } from "./s1/riskFactorsModel";
import type { SpacClassificationRow } from "./s1/spacClassifierSchema";
import { looksLikeBlankCheck } from "./s1/spacContentHeuristic";
import { getSpacClassifierConfidenceFloor, getSpacClassifierModel } from "./s1/spacClassifierModel";
import type { SpacProfileRow } from "./s1/spacProfileSchema";
import type { BeneficialOwnerRow, ManagementPersonRow, RelatedPartyRow } from "./s1/sectionSchemas";
import { makeRunSection } from "./s1/sectionRunner";
import { offeringSectionNames, runOfferingSections } from "./s1/offeringSections";
import { getS1Models, modelExtractChain, persistModelId, resolveModelId } from "./s1/s1Model";
import { splitPersonName } from "./s1/splitName";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

const EXTRACTOR_ID = "S-1";
/** Dead-letter section name for the risk-factor list. */
const RISK_FACTORS_SECTION = "risk-factors";
/**
 * Dead-letter section name for the converter itself, rather than any one
 * section: the tree carried no usable structure and the line scan stood in.
 */
const CONVERTER_SECTION = "converter";
/**
 * Characters of prospectus summary required before its silence about blank-check
 * language can demote a 6770 header SIC. See the downgrade block below.
 */
const MIN_SUMMARY_CHARS_TO_DEMOTE = 2_000;
/**
 * Blank-check signals a summary needs before the 6770 header stands — i.e. the
 * header is demoted only on a summary carrying **none**.
 *
 * Deliberately looser than `looksLikeBlankCheck`'s default of 2, because the two
 * callers ask the same question with opposite error costs. As the AI pre-filter,
 * a false negative skips a model call. Here, a false negative deletes the
 * `spac` row and with it the whole 8-K / merger-proxy / Form 25-15 tier.
 *
 * At 2 it demoted `Lucent, Inc.` — a Montana shell whose summary states "the
 * proposed business activities described herein classify the Company as a
 * 'blank check' company" — because the phrase is its ONLY signal: a small
 * blank-check shell has no trust account, no founder shares and no sponsor, so
 * it never reaches the SPAC-IPO vocabulary the list is built from. Measured over
 * the committed corpus, all 20 labelled SPAC summaries carry ≥2 signals and
 * every non-SPAC with a 6770 header (Ionetix, Moolec, Zhong Yuan) carries zero,
 * so demoting only at zero separates every observed case and keeps the
 * borderline ones on today's behavior.
 */
const DEMOTE_MIN_BLANK_CHECK_SIGNALS = 1;
// Stays 1.0.0: there is no persisted data to re-extract, so the version-bump
// ceremony — which exists only to make old dead-letters retry-eligible after a
// prompt/schema change — is moot (and the runtime version is bootstrap-seeded
// to 1.0.0 regardless of this fallback). The prompt/schema has evolved
// (source_span verification, prompt-injection hardening, the SPAC "Prospectus
// Summary" profile section), but with a blank DB none of it needs a bump;
// revisit versioning once a populated database exists.
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";

/**
 * Every dead-letter section name a full S-1 sweep could have recorded, for use
 * by the two paths that return before running any section — a Rule 462(b)
 * short-form registration and a Part II-only amendment — to resolve what an
 * earlier sweep left pending.
 *
 * Deliberately a superset rather than the exact list that run would produce:
 * `markResolved` no-ops on a missing entry, so over-listing is free, while
 * under-listing strands an entry forever. It therefore ignores `isSpac` for the
 * SPAC-only sections — the flag is derived from SIC code and heuristics and can
 * differ between the sweeping run and this one, which is exactly the case that
 * would otherwise leak. The `-partial` siblings are included because
 * `runSection` records those alongside the section itself.
 */
export function sectionlessResolvableSections(): readonly string[] {
  const base = [
    S1_SECTIONS.MANAGEMENT,
    S1_SECTIONS.BENEFICIAL_OWNERSHIP,
    S1_SECTIONS.RELATED_PARTY,
    S1_SECTIONS.EXECUTIVE_COMPENSATION,
    RISK_FACTORS_SECTION,
    ...offeringSectionNames(true),
    "spac-profile",
    "spac-sponsors",
    "spac-classification",
    CONVERTER_SECTION,
  ];
  return [...base, ...base.map((s) => `${s}-partial`)];
}

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

/**
 * Risk-factors extraction is parked: the section dominates per-filing cost and
 * is excluded from default eval sweeps. Flip this (or pass
 * `extractRiskFactors: true`) to turn it back on. Tests of the extractor path
 * always pass the override so they keep scoring the real ceremony.
 */
const EXTRACT_S1_RISK_FACTORS = false;

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
  readonly extractRiskFactors?: boolean;
}

export async function processFormS1(args: ProcessFormS1Args): Promise<void> {
  const { cik, accession_number, formS1 } = args;
  const runRiskFactors = args.extractRiskFactors ?? EXTRACT_S1_RISK_FACTORS;
  // A misconfigured/unregistered SEC_S1_MODEL must not discard the deterministic
  // work below (XBRL facts, issuer identity, the SPAC registration row). Resolve
  // to null on failure and dead-letter the AI sections, mirroring the PARSE_ERROR
  // containment further down (and the redemption 8-K path).
  let models: ModelConfig[] = [];
  let modelError: string | null = null;
  try {
    models = args.model ? [args.model] : await getS1Models();
  } catch (err) {
    modelError = err instanceof Error ? err.message : String(err);
  }
  const model = models[0] ?? null;
  const model_id = model ? resolveModelId(model) : null;
  // Fetch a local model's weights up front so the download's progress renders in
  // the CLI task UI before the (silent) per-section extraction begins.
  for (const m of models) await prefetchModel(resolveModelId(m), args.context);

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
  // While parked, leave previously extracted rows in place: a replay must not
  // wipe the last good extraction of a section this run is not replacing.
  if (runRiskFactors) {
    await riskFactorRepo.clear(accession_number);
  }
  await linkRepo.clear(accession_number);

  if (!runRiskFactors) {
    await deadLetters.markResolved(EXTRACTOR_ID, accession_number, RISK_FACTORS_SECTION);
    await deadLetters.markResolved(
      EXTRACTOR_ID,
      accession_number,
      `${RISK_FACTORS_SECTION}-partial`
    );
    await deadLetters.markResolved(
      EXTRACTOR_ID,
      accession_number,
      `${RISK_FACTORS_SECTION}-echo-dropped`
    );
  }

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

  // A de-SPAC newco (S-4/F-4 + 8-A12B/8-A12G on this CIK, dated on or before
  // this filing) keeps SIC 6770 on later resale S-1s, and the summary often
  // still reads like a blank check because it recounts the combination. That
  // pair of filings is the listing of the surviving company, not a SPAC IPO —
  // do not mint. A later S-4 on a genuine SPAC CIK must not reject the original
  // blank-check registration. A CIK that already has a spac row from a
  // different accession is a real SPAC that later filed an S-4; leave it alone.
  const priorEventsForNewco = await new SpacRepo().getEvents(cik);
  const alreadyKnownForNewco = priorEventsForNewco.some(
    (event) => event.accession_number !== accession_number
  );
  let newcoListingRejected = false;
  if (
    isSpac &&
    !alreadyKnownForNewco &&
    (await issuerHasCombinationListing(cik, args.filing_date))
  ) {
    isSpac = false;
    newcoListingRejected = true;
    await new S1ClassificationRepo().save({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      cik,
      sic: headerSic,
      sic_description: formS1.header?.sicDescription ?? null,
      is_spac: false,
      classifier_source: "newco-listing",
      created_at: new Date().toISOString(),
    });
  }

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

  const recordFail = (section: string, reason: DeadLetterReasonCode, detail: string | null) =>
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
      ...(runRiskFactors ? [RISK_FACTORS_SECTION] : []),
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

  // A Rule 462(b) short-form registration (`S-1MEF` / `F-1MEF`) registers
  // ADDITIONAL securities for an offering whose prospectus is already on file,
  // and incorporates that earlier registration statement by reference. It is a
  // cover page and a signature block — 26 Capital's is 8,570 characters — and
  // carries no management roster, no ownership table, no risk factors.
  //
  // Running the full section sweep over one dead-letters all ten sections as
  // SECTION_NOT_FOUND. That is noise, not a finding: nothing is missing, the
  // sections were never there. Four such filings produced 40 of the 104
  // SECTION_NOT_FOUND entries across this fleet.
  //
  // Resolve any entries an earlier sweep already recorded before returning.
  // Skipping the sweep stops NEW noise but cannot clear the old: every other
  // resolution happens per-section inside runSection, which this path never
  // reaches, so without this the stale entries are stuck pending forever —
  // never retried (nothing re-attempts them) and never resolved. They are
  // resolved rather than deleted because the entry is a true historical record
  // of a run that did fail; it is the pending state that is wrong.
  //
  // Still record the registration event: the SGML header carries the name, SIC
  // and date, which is exactly what the SPAC row needs, and the MEF is a real
  // step in the offering.
  if (SECTIONLESS_REGISTRATION_FORMS.has(args.form)) {
    if (isSpac) await new SpacReportWriter().recordRegistration(baseReg);
    for (const section of sectionlessResolvableSections()) {
      // No-ops when no entry exists, so this costs nothing on a first run.
      await deadLetters.markResolved(EXTRACTOR_ID, accession_number, section);
    }
    return;
  }

  // Converting real-world HTML can throw on malformed/adversarial input. A throw
  // here would abort the whole filing with no record; instead dead-letter every
  // target section as PARSE_ERROR so the filing stays on the retry worklist.
  let byName: Map<S1SectionName, string>;
  let usedLineScan = false;
  try {
    const doc = parseEdgarHtml(formS1.html, `S-1 ${accession_number}`);
    const segmented = new DocumentTreeSegmenter().segmentDocument(doc);
    usedLineScan = segmented.usedLineScan;
    byName = new Map<S1SectionName, string>(segmented.sections.map((s) => [s.name, s.text]));
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
      ...(runRiskFactors ? [RISK_FACTORS_SECTION] : []),
      ...offeringSectionNames(isSpac),
      ...(isSpac ? ["spac-profile", "spac-sponsors"] : []),
      ...(!isSpac && looksLikeBlankCheck(formS1.html) ? ["spac-classification"] : []),
    ];
    for (const section of sectionNames) {
      await recordFail(section, "PARSE_ERROR", detail);
    }
    return;
  }
  // An amendment filed only to add exhibits or answer a comment letter carries
  // no prospectus, so the ten sections below are absent for the same reason they
  // are absent from an S-1MEF: there is nothing to find. Treated identically —
  // record the registration, resolve anything an earlier sweep left pending, and
  // return — but decided from content, because the form type is the ordinary
  // `S-1/A` that usually DOES carry a prospectus. Gated on the segmenter finding
  // nothing at all, so a filing that resolved even one section still takes the
  // normal path and reports its genuine failures.
  if (byName.size === 0 && looksLikePartIIOnlyAmendment(formS1.html)) {
    if (isSpac) await new SpacReportWriter().recordRegistration(baseReg);
    for (const section of sectionlessResolvableSections()) {
      await deadLetters.markResolved(EXTRACTOR_ID, accession_number, section);
    }
    return;
  }

  // The converter produced a document with no usable structure and the line
  // scan stood in for it. Whatever it recovered still gets extracted below —
  // but a filing whose prospectus we could not read is a defect worth counting,
  // and it is invisible otherwise: on the tree-walk path such a filing reported
  // nothing but SECTION_NOT_FOUND, which is also what a legitimate
  // incorporation-by-reference S-1 reports.
  //
  // Under its own section name rather than the filing-level `""`, which belongs
  // to `ProcessAccessionDocFormTask`'s fetch/parse/store staging — that task
  // resolves `""` after a successful store, which would clear this entry on the
  // very run that recorded it.
  if (usedLineScan) {
    await recordFail(
      CONVERTER_SECTION,
      "CONVERTER_NO_STRUCTURE",
      `tree walk resolved no usable sections; recovered ${byName.size} by line scan`
    );
  } else {
    await deadLetters.markResolved(EXTRACTOR_ID, accession_number, CONVERTER_SECTION);
  }

  const recordOk = (section: S1SectionName) =>
    deadLetters.markResolved(EXTRACTOR_ID, accession_number, section);

  const runSection = makeRunSection({
    deadLetters,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    accession_number,
    signal: args.context?.signal,
  });

  // The entity sections feed a SECTION_NOT_FOUND with a `null` detail when the
  // text is undefined. `runSection` also treats a blank string as not-found,
  // but the original entity blocks only checked `=== undefined`. Section text
  // sourced directly from `byName` is never the empty string (the segmenter
  // emits non-empty section bodies), so the two checks coincide in practice.

  // --- Header-SIC downgrade (post-de-SPAC filings) ---
  // The header SIC is stale on a registration statement filed AFTER the
  // combination closed: the surviving operating company keeps the shell's CIK,
  // and EDGAR keeps coding the filer 6770 long afterwards. Ionetix Corp — filed
  // as JDEV Acquisition Corp — filed a 2026 S-1 under a `BLANK CHECKS [6770]`
  // header carrying 1,844 XBRL facts of real operating financials. Minting a
  // known-SPAC row for it gates the whole 8-K / merger-proxy / Form 25-15 tier
  // onto a company that already de-SPAC'd, and nothing downstream could overturn
  // it: the AI content classifier below only runs when the deterministic path
  // did NOT flag the filing.
  //
  // So the header SIC has to agree with the prospectus. The gate reads the
  // SUMMARY, not the whole document — a de-SPAC prospectus recounts its own SPAC
  // history at length, so the raw-HTML heuristic passes filings this is meant to
  // catch. Downgrading here (rather than dropping the filing) leaves the AI
  // classifier below as the second chance, exactly as for a miscoded SIC.
  //
  // Only a SUBSTANTIAL summary can demote. Silence is evidence only where there
  // was room to speak: a blank-check company's summary says what it is many
  // times over, but a stub says nothing about anything, and demoting on it would
  // turn a segmentation shortfall into a classification. The smallest summary in
  // the committed corpus is ~13.6k characters, so this bar is well beneath every
  // real one while still excluding a fragment.
  //
  // And it never demotes a CIK that is ALREADY a known SPAC. A CIK that once
  // registered as a blank check stays a SPAC CIK for good: the shell keeps its
  // CIK through the combination and renames, which is precisely what the spac
  // row's three eras (`spac_*` / `post_merger_*` / `current_*`) exist to model.
  // A post-combination registration statement therefore reads like the operating
  // company it now is — that is the normal, expected shape, not evidence that
  // the vehicle was never a SPAC — so judging it afresh on its prose would
  // detach a filing from the very lifecycle row it belongs to. The content gate
  // is for a CIK nothing knows about yet, where the only question is whether to
  // MINT a row on the strength of a stale header.
  //
  // "Already known" therefore has to mean evidence from a DIFFERENT accession.
  // Four earlier paths (no model, MEF, parse error, Part-II-only amendment)
  // record the registration before segmentation, and that appends an event and
  // rebuilds the spac row — so `getSpac(cik)` is already defined on the retry
  // that finally CAN read the prospectus, and this filing would be reading its
  // own earlier pass as prior evidence about itself. Reading the event log is a
  // faithful narrowing rather than a change of subject: the row is derived from
  // the append-only log, so a spac row always carries at least one event.
  //
  // Residual, and unavoidable: a de-SPAC filer whose first seen filing was a
  // MEF under a stale 6770 header still mints a row and still gates its later
  // filings. A MEF is a cover page — there is nothing in it to judge.
  if (isSpac) {
    const summary = byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY) ?? "";
    const priorEvents = await new SpacRepo().getEvents(cik);
    const alreadyKnownSpac = priorEvents.some(
      (event) => event.accession_number !== accession_number
    );
    if (
      !alreadyKnownSpac &&
      summary.length >= MIN_SUMMARY_CHARS_TO_DEMOTE &&
      !looksLikeBlankCheck(summary, DEMOTE_MIN_BLANK_CHECK_SIGNALS)
    ) {
      isSpac = false;
      await new S1ClassificationRepo().save({
        extractor_id: EXTRACTOR_ID,
        accession_number,
        cik,
        sic: headerSic,
        sic_description: formS1.header?.sicDescription ?? null,
        is_spac: false,
        classifier_source: "sgml-header-rejected",
        created_at: new Date().toISOString(),
      });
    }
  }

  // --- AI SPAC content classification (SIC-miscoded upgrade path) ---
  // The deterministic classifier above only flags SIC == 6770. A SPAC filed
  // under a miscoded/absent SIC would be missed, so — when the filing was NOT
  // already classified as a SPAC and its summary prose is blank-check-like (the
  // cheap heuristic keeps the AI call rare, reserved for plausibly miscoded
  // filings) — run an AI content classifier behind the `classifier_source =
  // "ai"` seam. A confident SPAC verdict upgrades the local flag AND overwrites
  // the classification row, so the registration / profile / offering blocks
  // below treat it as a known SPAC and its de-SPAC 8-K milestones can attach.
  if (!isSpac && !newcoListingRejected) {
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
        const classifierHolder: { upgraded: boolean; source: "ai" | "deterministic" } = {
          upgraded: false,
          source: "ai",
        };
        const classifierRunSection = makeRunSection({
          deadLetters,
          extractor_id: EXTRACTOR_ID,
          extractor_version,
          accession_number,
          confidenceFloor: getSpacClassifierConfidenceFloor(),
          signal: args.context?.signal,
        });
        await classifierRunSection<SpacClassificationRow>({
          sectionName: "spac-classification",
          text: classifyText,
          emptyDetail: "not classified as a SPAC",
          lowConfidenceDetail: "SPAC classification below confidence floor",
          verifyRow: (text, r) => classifySpan(text, r.source_span),
          unverifiedAllDetail:
            "the confident SPAC classification had source_span not present in section text",
          extract: async (text) => {
            const det = parseSpacClassification(text);
            if (det !== null) return [det];
            const c = await extractSpacClassification(text, classifierModelResolved, args.context);
            return c === null ? [] : [c];
          },
          persist: async (rows) => {
            classifierHolder.upgraded = true;
            if (rows[0]?.source === "deterministic") classifierHolder.source = "deterministic";
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
            classifier_source: classifierHolder.source,
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
      verifyRow: (text, r) => classifySpan(text, r.source_span),
      unverifiedAllDetail: "the confident SPAC profile had source_span not present in section text",
      ...modelExtractChain(models, async (text, m) => {
        const det = parseSpacProfile(text);
        if (det !== null) return [det];
        const p = await extractSpacProfile(text, m, args.context);
        return p === null ? [] : [p];
      }),
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
    verifyRow: (text, r) => classifySpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident management rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident management rows had source_span not present in section text",
    ...modelExtractChain(models, async (text, m) => {
      const det = parseManagementRoster(text);
      if (det.length > 0) return det;
      return extractManagement(text, m, args.context);
    }),
    persist: async (rows, meta) => {
      const model_id =
        rows[0]?.source === "deterministic"
          ? DETERMINISTIC_MODEL_ID
          : persistModelId(models, meta.modelIndex);
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
    verifyRow: (text, r) => classifySpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident ownership rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident ownership rows had source_span not present in section text",
    ...modelExtractChain(models, async (text, m) => {
      const det = parseBeneficialOwnership(text);
      if (det.length > 0) return det;
      return extractBeneficialOwnership(text, m, args.context);
    }),
    persist: async (rows, meta) => {
      const model_id =
        rows[0]?.source === "deterministic"
          ? DETERMINISTIC_MODEL_ID
          : persistModelId(models, meta.modelIndex);
      for (const r of rows) {
        if (r.owner_kind === "company" && isUnnamedCompanyName(r.name)) continue;
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
    verifyRow: (text, r) => classifySpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident related-party rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident related-party rows had source_span not present in section text",
    ...modelExtractChain(models, async (text, m) => {
      const det = parseRelatedPartyTables(text);
      if (det.length > 0) return det;
      return extractRelatedParty(text, m, args.context);
    }),
    persist: async (rows, meta) => {
      const model_id =
        rows[0]?.source === "deterministic"
          ? DETERMINISTIC_MODEL_ID
          : persistModelId(models, meta.modelIndex);
      // Check every row against the storage schema's own declared bounds BEFORE
      // writing any of them. This persist spans three storages (observations,
      // provenance, transactions) and `withTransaction` is scoped to a single
      // one, so a write that throws part-way through the loop cannot be rolled
      // back: the section ends up both partly persisted and dead-lettered,
      // which reads downstream as a complete disclosure that is actually
      // truncated. A real filing hit exactly this — an over-long `period` threw
      // on row 6 and left 5 rows behind. Failing up front turns that into
      // "nothing written, dead letter recorded", which is what the
      // all-or-nothing section contract already promises.
      assertWithinDeclaredBounds(
        rows.flatMap((r) => r.transactions),
        RelatedPartyTransactionSchema,
        "related-party transaction"
      );
      let txIndex = 0;
      for (const r of rows) {
        // Item 404 disclosures are routinely made against the officer/director
        // group as a class ("our officers and directors may receive a finder's
        // fee"), and the model returns the group's label as a person. The
        // disclosure is real and is kept; the person is not. Such a row is
        // stored as `party_kind: "group"` with the filing's wording in
        // `party_label` and no observation — recording the money without the
        // subject would be worse than either. The model is never asked for
        // "group": it classifies person/company, and this derives the third
        // kind, so a model that has never heard of the distinction cannot get
        // it wrong. On one live filing this was every single related-party
        // person: four rows, no actual individuals.
        // A blank name is the same class of degenerate model output the
        // sponsor persist already skips. A name that is only a legal-form
        // ending ("Company") or an issuer self-reference ("the Company")
        // normalizes to empty or a stranded article ("the") and would mint a
        // canonical company — treat it as unnamed, keeping the filing's wording
        // on party_label.
        const trimmedName = (r.name ?? "").trim();
        const isCollective =
          trimmedName === "" ||
          (r.party_kind === "company" && isUnnamedCompanyName(trimmedName)) ||
          (r.party_kind === "person" && isCollectivePartyName(r.name));
        const partyKind = isCollective ? ("group" as const) : r.party_kind;
        let observation_id: number | null = null;
        if (!isCollective) {
          const observation_index = idx++;
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
        }
        for (const t of r.transactions) {
          await relatedRepo.save({
            accession_number,
            extractor_id: EXTRACTOR_ID,
            transaction_index: txIndex++,
            party_kind: partyKind,
            observation_id,
            party_label: isCollective && trimmedName !== "" ? r.name : null,
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
  // single sentence stating that no officer or director has been paid, and most
  // registration statements carry no compensation section at all. NEITHER is a
  // failure, so neither costs an AI call and neither leaves a dead letter —
  // both resolve, which also clears an entry a previous version left behind so
  // a correctly-behaving filing never lingers on the version-gated retry
  // worklist (markResolved no-ops when none exists).
  //
  // "No section matched" therefore does not dead-letter, unlike the other
  // sections. It would put an `Executive Compensation` entry on
  // `sec extractor dead-letters S-1` for the MAJORITY of all S-1s, permanently
  // (only a version bump clears one), burying every genuinely triageable entry.
  // The heading-coverage question that motivates recording it — is a real Item
  // 402 disclosure being missed by a spelling the patterns do not know? — is a
  // counting question, and belongs on a counting surface rather than on the
  // retry worklist.
  const compensationText = byName.get(S1_SECTIONS.EXECUTIVE_COMPENSATION);
  if (compensationText === undefined || compensationText.trim() === "") {
    await recordOk(S1_SECTIONS.EXECUTIVE_COMPENSATION);
  } else if (!hasSummaryCompensationTable(compensationText)) {
    await recordOk(S1_SECTIONS.EXECUTIVE_COMPENSATION);
  } else {
    await runSection<ExecutiveCompensationRow>({
      sectionName: S1_SECTIONS.EXECUTIVE_COMPENSATION,
      text: compensationText,
      emptyDetail: "no compensation rows returned",
      lowConfidenceDetail: "all rows below confidence floor",
      verifyRow: (text, r) => classifySpan(text, r.source_span),
      unverifiedAllDetail:
        "all $T confident compensation rows had source_span not present in section text",
      unverifiedPartialDetail:
        "$N of $T confident compensation rows had source_span not present in section text",
      ...modelExtractChain(models, async (text, m) => {
        const det = parseSummaryCompensationTable(text);
        if (det.length > 0) return det;
        return extractExecutiveCompensation(text, m, args.context);
      }),
      persist: async (rows, meta) => {
        const model_id =
          rows[0]?.source === "deterministic"
            ? DETERMINISTIC_MODEL_ID
            : persistModelId(models, meta.modelIndex);
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
  // Parked unless EXTRACT_S1_RISK_FACTORS (or the per-call override) is on;
  // leftover dead-letters were already resolved above.
  if (runRiskFactors) {
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
      let riskModels: ModelConfig[] = [];
      let riskModelError: string | null = null;
      try {
        riskModels = args.model ? [args.model] : await getRiskFactorsModels();
      } catch (err) {
        riskModelError = err instanceof Error ? err.message : String(err);
      }
      if (riskModels.length === 0) {
        await recordFail(RISK_FACTORS_SECTION, "MODEL_RESOLUTION_ERROR", riskModelError);
      } else {
        for (const m of riskModels) await prefetchModel(resolveModelId(m), args.context);
        // Headlines the extractor deleted as echoes of a heading the chunker
        // prefixed onto a chunk. Reset per extraction attempt so a re-ask's
        // verdict replaces the previous one rather than accumulating.
        let droppedEchoes: readonly string[] = [];
        const riskRunSection = makeRunSection({
          deadLetters,
          extractor_id: EXTRACTOR_ID,
          extractor_version,
          accession_number,
          confidenceFloor: getRiskFactorsConfidenceFloor(),
          signal: args.context?.signal,
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
          // MAX_SPAN_CHARS raw chars) inside the column's declared width.
          //
          // An elided headline fails outright rather than going through
          // classifySpan, which would salvage the pre-"..." head. That salvage is
          // right for a citation — a real quote you can find in the filing beats
          // no citation — but wrong for this field: the caption's contract is the
          // filer's sentence verbatim, and a truncated one is stored as a
          // complete caption with no marker saying otherwise. Dropping the row
          // routes it into the existing `-partial` / UNVERIFIED_SOURCE_SPAN
          // machinery instead of quietly recording an abridged disclosure.
          verifyRow: (text, r) =>
            worstVerdict(
              classifySpan(text, r.source_span),
              isElided(r.headline) ? "not-found" : classifySpan(text, r.headline)
            ),
          unverifiedAllDetail:
            "all $T confident risk factor rows had headline/source_span not present in section text",
          unverifiedPartialDetail:
            "$N of $T confident risk factor rows had headline/source_span not present in section text",
          ...modelExtractChain(riskModels, (text, m) => {
            droppedEchoes = [];
            return extractRiskFactors(text, m, args.context, (headlines) => {
              droppedEchoes = headlines;
            });
          }),
          persist: async (rows) => {
            const now = new Date().toISOString();
            let riskIndex = 0;
            for (const r of rows) {
              // Stored whole. Every row reaching persist has already had its
              // headline verified verbatim against the section text and rejected
              // if elided, so there is nothing left to salvage here — cutting at
              // an elision marker would only be able to shorten a caption that
              // is already the filer's complete sentence.
              const headline = (r.headline ?? "").trim();
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
        // Reconcile a sibling triage entry for the echo drop, mirroring the
        // `-partial` reconciliation runSection does for unverified rows. The drop
        // deletes rows the model returned and the section still resolves as
        // complete, so it must leave a durable, attributable record: the entry
        // carries the accession, the section and the dropped text verbatim, so an
        // operator can read what was removed and judge it. Resolve it when this
        // run dropped nothing, so a filing that stops dropping stops lingering on
        // the worklist (markResolved no-ops when no entry exists).
        const echoSection = `${RISK_FACTORS_SECTION}-echo-dropped`;
        if (droppedEchoes.length > 0) {
          await recordFail(
            echoSection,
            "MODEL_INVALID_OUTPUT",
            `dropped ${droppedEchoes.length} row(s) echoing the category heading carried into a ` +
              `chunk: ${droppedEchoes.map((h) => JSON.stringify(h)).join("; ")}`
          );
        } else {
          await deadLetters.markResolved(EXTRACTOR_ID, accession_number, echoSection);
        }
      }
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
    models,
    model_id,
    activeUnderwriterFamilyVersion,
    byName,
    context: args.context,
    markSectionResolved: (section) =>
      deadLetters.markResolved(EXTRACTOR_ID, accession_number, section),
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
    invalidWriteDetail: "no sponsor rows had a usable legal name",
    // v1.1.0: verify the LLM-returned source_span actually appears in the
    // section text we sent. The sponsor-section input may be the concatenation
    // of management/ownership/related-party text (when "The Sponsor" heading
    // is absent), so an LLM can hallucinate company names from director bios;
    // this gate stops unverified rows from being written as fact-claims keyed
    // to the issuer CIK.
    verifyRow: (text, r) => classifySpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident sponsor rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident sponsor rows had source_span not present in section text",
    ...modelExtractChain(models, async (text, m) => {
      const det = parseSpacSponsors(text);
      if (det.length > 0) return det;
      return extractSpacSponsors(text, m, args.context);
    }),
    persist: async (rows, meta) => {
      const model_id =
        rows[0]?.source === "deterministic"
          ? DETERMINISTIC_MODEL_ID
          : persistModelId(models, meta.modelIndex);
      let wrote = 0;
      const splits = rows.map((r) => splitParentClause(r.legal_name?.trim() ?? ""));
      const extractedNames = splits.map((s) => s.observationName);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const split = splits[i]!;
        // A row whose legal name is blank (degenerate model output)
        // is skipped rather than allowed to throw inside the resolver and abort
        // every other valid sponsor in this filing.
        if (split.observationName === "") continue;
        if (isUnnamedCompanyName(split.observationName)) continue;
        if (isCompanyFamilyPrefixEcho(split.observationName, extractedNames)) continue;
        // Same skip as underwriter persist: a letterless placeholder ("[●]")
        // is not an entity; a CJK name is observed without a family rather
        // than aborting the rest of the table via FamilyResolver.
        const familyKey = normalizeFamilyName(split.familyName);
        if (!familyKey && !/\p{L}/u.test(split.observationName)) continue;
        const observation_index = idx++;
        const { observation_id, canonical_company_id } = await observer.observeCompany({
          ...base,
          observation_index,
          name: split.observationName,
          source_context: parentClauseSourceContext("s1:spac-sponsor", split),
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
        if (!familyKey) {
          wrote++;
          continue;
        }
        const sponsor_family_id = await sponsorFamilyResolver.resolve(split.familyName);
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
