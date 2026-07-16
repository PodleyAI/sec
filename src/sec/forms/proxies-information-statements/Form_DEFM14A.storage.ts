/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type IExecuteContext, type ModelConfig } from "workglow";
import { prefetchModel } from "../../../config/ensureModelDownloaded";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { CanonicalCompanyRepo } from "../../../storage/canonical/CanonicalCompanyRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacMergerExtractionRepo } from "../../../storage/spac/SpacMergerExtractionRepo";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../registration-statements/s1/DocumentTreeSegmenter";
import { S1_SECTIONS, type S1SectionName } from "../registration-statements/s1/DocumentSegmenter";
import { makeRunSection } from "../registration-statements/s1/sectionRunner";
import { boundSourceSpan, verifyRowSpan } from "../registration-statements/s1/verifySourceSpan";
import { extractMergerDeal } from "../registration-statements/s1/sectionExtractors";
import type { MergerDealRow } from "../registration-statements/s1/mergerDealSchema";
import {
  getMergerProxyModel,
  getMergerProxyConfidenceFloor,
  resolveModelId,
} from "../registration-statements/s1/mergerModel";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";

const EXTRACTOR_ID = "merger-proxy";
// Stays 1.0.0: no persisted data to re-extract, so the target_description
// addition needs no version bump (see the S-1 processor for the rationale).
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";
const MERGER_SECTION = "merger";
/** Definitive merger statements emit a `proxy` lifecycle event; others do not. */
const DEFINITIVE_PROXY_FORMS = new Set(["DEFM14A", "DEFM14C"]);

export interface ProcessMergerProxyArgs {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly formMergerProxy: FormS1Parsed;
  readonly model?: ModelConfig;
  readonly context?: IExecuteContext;
}

/**
 * Extract the deal identity + PIPE from a SPAC merger proxy — the 14A/14C merger
 * and revised-proxy family (`DEFM14A`/`PREM14A`, `DEFM14C`/`PREM14C`,
 * `DEFR14A`/`PRER14A`); see {@link DEFINITIVE_PROXY_FORMS} for which emit the
 * proxy event. Gated on a known SPAC. Persists a `spac_merger_extraction` row,
 * observes the target company, then records the proxy event and recomputes deals
 * (correlation derives target/pipe onto the matching `spac_deal`). Degrades
 * gracefully: when the merger section is absent or low-confidence, it dead-letters
 * and still emits the proxy event (for definitive merger statements) so
 * `proxy_date` advances.
 */
export async function processMergerProxy(args: ProcessMergerProxyArgs): Promise<void> {
  const { cik, accession_number, form, filing_date, formMergerProxy } = args;

  // Gate: known SPACs only (the proxy filer is always the SPAC).
  const spacRow = await new SpacRepo().getSpac(cik);
  if (!spacRow) return;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const [extractorSlot, personSlot, companySlot] = await Promise.all([
    getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID),
    getActiveSlot(versionRegistry, "resolver", "person"),
    getActiveSlot(versionRegistry, "resolver", "company"),
  ]);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  // bootstrapComponentVersions seeds the current slot for every known
  // extractor; the fallback only protects tests that bypass setupAllDatabases.
  const slot_at_run = extractorSlot?.slot ?? "current";
  const observer = buildEntityObserver({
    activeResolverPersonVersion: personSlot?.semver ?? "1.0.0",
    activeResolverCompanyVersion: companySlot?.semver ?? "1.0.0",
  });
  const provenance = new ObservationProvenanceRepo();
  const deadLetters = new ExtractionDeadLetterRepo();
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  // A misconfigured/unregistered merger-proxy model must not abort the filing:
  // the deterministic proxy event (definitive statements) is still emitted below.
  // Resolve to null on failure and dead-letter the merger section.
  let model: ModelConfig | null;
  let modelError: string | null = null;
  try {
    model = args.model ?? (await getMergerProxyModel());
  } catch (err) {
    model = null;
    modelError = err instanceof Error ? err.message : String(err);
  }
  const model_id = model ? resolveModelId(model) : null;
  await prefetchModel(model, args.context);

  const recordMergerProxyRun = async (success: boolean, error: string | null): Promise<void> => {
    try {
      await runRepo.recordRun({
        cik,
        accession_number,
        form,
        extractor_id: EXTRACTOR_ID,
        extractor_version,
        slot_at_run,
        success,
        error: error === null ? null : error.slice(0, 4096),
      });
    } catch (recordErr) {
      console.error(
        `Failed to record extractor_runs row for ${cik}/${accession_number}@${EXTRACTOR_ID}:${extractor_version}:`,
        recordErr
      );
    }
  };

  // Segment; PARSE_ERROR dead-letters the merger section so a retry can resolve it.
  let byName: Map<S1SectionName, string>;
  try {
    const doc = parseEdgarHtml(formMergerProxy.html, `${form} ${accession_number}`);
    const sections = new DocumentTreeSegmenter().segment(doc);
    byName = new Map<S1SectionName, string>(sections.map((s) => [s.name, s.text]));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: MERGER_SECTION,
      reason_code: "PARSE_ERROR",
      detail: message,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    await recordMergerProxyRun(false, `PARSE_ERROR: ${message}`);
    return;
  }

  // Prefer the merger / business-combination / PIPE sections; concatenate when
  // multiple are present. (No whole-document fallback: proxies are huge.)
  const mergerText = [
    byName.get(S1_SECTIONS.THE_MERGER),
    byName.get(S1_SECTIONS.BUSINESS_COMBINATION),
    byName.get(S1_SECTIONS.PIPE_FINANCING),
  ]
    .filter((t): t is string => typeof t === "string")
    .join("\n\n");

  let idx = 0;

  if (!model) {
    // No model: dead-letter the merger section but still emit the proxy event
    // (deterministic, definitive statements only) so the SPAC timeline advances.
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: MERGER_SECTION,
      reason_code: "MODEL_RESOLUTION_ERROR",
      detail: modelError,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
  } else {
    const runSection = makeRunSection({
      deadLetters,
      extractor_id: EXTRACTOR_ID,
      extractor_version,
      accession_number,
      confidenceFloor: getMergerProxyConfidenceFloor(),
    });
    try {
      await runSection<MergerDealRow>({
        sectionName: MERGER_SECTION,
        text: mergerText === "" ? undefined : mergerText,
        notFoundDetail: "no merger / business-combination / PIPE section text",
        emptyDetail: "no merger deal returned",
        lowConfidenceDetail: "below confidence floor",
        verifyRow: (text, r) => verifyRowSpan(text, r.source_span),
        unverifiedAllDetail: "merger deal source_span not present in section text",
        extract: async (text) => {
          const deal = await extractMergerDeal(text, model, args.context);
          return deal === null ? [] : [deal];
        },
        persist: async (rows) => {
        const deal = rows[0];
        const now = new Date().toISOString();
        let target_observation_id: number | null = null;
        let target_cik: number | null = null;
        const targetName = deal.target_name?.trim() ?? "";
        if (targetName !== "") {
          const { observation_id, canonical_company_id } = await observer.observeCompany({
            accession_number,
            extractor_id: EXTRACTOR_ID,
            extractor_version,
            observation_index: idx++,
            name: targetName,
            source_context: JSON.stringify({ relation: "merger-proxy:target" }),
          });
          target_observation_id = observation_id;
          // target_cik only when the resolved canonical company already carries one.
          const canon = await new CanonicalCompanyRepo().getById(canonical_company_id);
          target_cik = canon?.cik ?? null;
          await provenance.save({
            kind: "company",
            observation_id,
            confidence: deal.confidence,
            source_span: boundSourceSpan(deal.source_span),
            section_name: MERGER_SECTION,
            model_id,
            prompt_version: extractor_version,
            extra: null,
          });
        }
        await new SpacMergerExtractionRepo().save({
          accession_number,
          cik,
          form,
          filing_date,
          extractor_id: EXTRACTOR_ID,
          extractor_version,
          target_name: targetName === "" ? null : targetName,
          target_cik,
          target_observation_id,
          target_description: deal.target_description ?? null,
          pipe_amount: deal.pipe_amount,
          merger_consideration: deal.merger_consideration,
          confidence: deal.confidence,
          source_span: boundSourceSpan(deal.source_span),
          model_id,
          created_at: now,
        });
        return 1;
      },
    });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordMergerProxyRun(false, message);
      throw err;
    }
  }

  // Emit the proxy event (definitive only) + recompute/correlate + rebuild.
  try {
    await new SpacReportWriter().recordMergerProxy({
      cik,
      accession_number,
      filing_date,
      form,
      primary_document: args.primary_doc ?? null,
      emitProxyEvent: DEFINITIVE_PROXY_FORMS.has(form),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordMergerProxyRun(false, message);
    throw err;
  }

  await recordMergerProxyRun(true, null);
}
