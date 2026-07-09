/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type ModelConfig } from "workglow";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import type { S1SectionName } from "./s1/DocumentSegmenter";
import { OFFERING_SECTION_NAMES, runOfferingSections } from "./s1/offeringSections";
import type { FormS1Parsed } from "./s1/parseSubmission";
import { getS1Model, resolveModelId } from "./s1/s1Model";
import { makeRunSection } from "./s1/sectionRunner";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

const EXTRACTOR_ID = "424";
// v1.1.0: shares the prompt-injection hardening rolled out on the S-1
// offering sections — UNTRUSTED_FILER_DOCUMENT wrap + verifyRow source_span
// verification on offering-terms / underwriters / use-of-proceeds. Prompt
// shape change ⇒ confidence calibration drifts ⇒ fresh dev cycle.
// v1.2.0: picks up the deepened injection seal from the shared offering
// section extractors — per-call nonce fence, entity-decode + NFKC + zero-
// width strip before defang, and raw-byte cap on stored source_span.
const DEFAULT_EXTRACTOR_VERSION = "1.2.0";

/**
 * The 424 variants that are full priced-IPO prospectuses (Rule 430A pricing
 * after effectiveness) and therefore worth the AI offering-sections pass.
 * Shelf takedowns and supplements (424B2/B3/B5, 424A) stay deterministic-only.
 */
const PRICED_PROSPECTUS_FORMS = new Set(["424B1", "424B4"]);

export interface ProcessForm424Args {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly form424: FormS1Parsed;
  readonly model?: ModelConfig;
}

/**
 * Processes 424 prospectuses. All variants run the deterministic XBRL pass
 * (fee-exhibit / inline facts) and observe the issuer so the filing resolves
 * to the same canonical company as its registration statement. The priced
 * forms (424B1 / 424B4) additionally run the AI offering sections — offering
 * terms, underwriters, use of proceeds — recording the FINAL deal under
 * extractor id `424` (the S-1 rows keep the registered/anticipated terms).
 */
export async function processForm424(args: ProcessForm424Args): Promise<void> {
  const { cik, accession_number, form424, form } = args;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const [extractorSlot, personSlot, companySlot, underwriterFamilySlot] = await Promise.all([
    getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID),
    getActiveSlot(versionRegistry, "resolver", "person"),
    getActiveSlot(versionRegistry, "resolver", "company"),
    getActiveSlot(versionRegistry, "resolver", "underwriter-family"),
  ]);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  const activeResolverPersonVersion = personSlot?.semver ?? "1.0.0";
  const activeResolverCompanyVersion = companySlot?.semver ?? "1.0.0";
  const activeUnderwriterFamilyVersion = underwriterFamilySlot?.semver ?? "1.0.0";

  const xbrl = await extractAndStoreXbrl({
    cik,
    accession_number,
    html: form424.html,
    xbrlInstanceXml: form424.xbrlInstanceXml,
    feeExhibitHtml: form424.feeExhibitHtml,
  });

  const observer = buildEntityObserver({
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });
  let idx = 0;
  await observer.observeCompany({
    accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    observation_index: idx++,
    cik,
    name: xbrl.name,
    jurisdiction: xbrl.jurisdiction,
    address_id: xbrl.address_id,
    international_number: xbrl.international_number,
    source_context: JSON.stringify(
      xbrl.hasIssuerAttributes
        ? { relation: "424:issuer", attributes_source: "xbrl-dei" }
        : { relation: "424:issuer" }
    ),
  });

  if (!PRICED_PROSPECTUS_FORMS.has(form)) return;

  const isSpac = form424.header?.sic === 6770;

  const deadLetters = new ExtractionDeadLetterRepo();
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

  // The IPO event is deterministic SPAC lifecycle bookkeeping — the priced
  // prospectus IS the IPO — so it must record regardless of whether the AI
  // offering sections completed. Reads spac_unit_terms null-tolerantly:
  // when the AI pass failed to produce a row (model resolution error, parse
  // error, low confidence), ipo_proceeds/trust_amount fall back to null so
  // the row still appears on the SPAC's timeline; a later replay can fill
  // the numeric fields once the version-gated dead letters clear.
  const recordSpacIpoEventIfEligible = async (): Promise<void> => {
    if (!isSpac) return;
    const unitTerms = await new SpacUnitTermsRepo().get(EXTRACTOR_ID, accession_number);
    const tickerRows = (await new IssuerTickerRepo().history(cik)).filter(
      (t) => t.accession_number === accession_number
    );
    const tickers = [...new Set(tickerRows.map((t) => t.ticker))];
    await new SpacReportWriter().recordIpo({
      cik,
      accession_number,
      filing_date: args.filing_date,
      form,
      primary_document: null,
      ipo_proceeds: unitTerms?.gross_proceeds ?? null,
      trust_amount:
        unitTerms?.trust_per_unit != null && unitTerms?.units_offered != null
          ? unitTerms.trust_per_unit * unitTerms.units_offered
          : null,
      spac_tickers: tickers.length > 0 ? tickers : null,
    });
  };

  // --- AI offering sections (priced prospectuses only) ---
  // Model resolution can throw when the configured model is not registered;
  // catch and dead-letter the AI sections so the deterministic SPAC IPO event
  // still records, mirroring the "XBRL failures never abort the filing" contract.
  let model: ModelConfig;
  try {
    model = args.model ?? (await getS1Model());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const section of OFFERING_SECTION_NAMES) {
      await recordFail(section, "MODEL_RESOLUTION_ERROR", detail);
    }
    await recordSpacIpoEventIfEligible();
    return;
  }
  const model_id = resolveModelId(model);

  // Mirror the S-1 PARSE_ERROR containment: a converter throw dead-letters the
  // offering sections so the filing stays on the retry worklist.
  let byName: Map<S1SectionName, string>;
  try {
    const doc = parseEdgarHtml(form424.html, `${form} ${accession_number}`);
    const sections = new DocumentTreeSegmenter().segment(doc);
    byName = new Map<S1SectionName, string>(sections.map((s) => [s.name, s.text]));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const section of OFFERING_SECTION_NAMES) {
      await recordFail(section, "PARSE_ERROR", detail);
    }
    await recordSpacIpoEventIfEligible();
    return;
  }

  await runOfferingSections({
    runSection: makeRunSection({
      deadLetters,
      extractor_id: EXTRACTOR_ID,
      extractor_version,
      accession_number,
    }),
    observer,
    provenance: new ObservationProvenanceRepo(),
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

  await recordSpacIpoEventIfEligible();
}
