/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  globalServiceRegistry,
  renderMarkdown,
  type IExecuteContext,
  type ModelConfig,
} from "workglow";
import { prefetchModel } from "../../../task/model/EnsureModelDownloadedTask";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { CanonicalCompanyRepo } from "../../../storage/canonical/CanonicalCompanyRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../../storage/dead-letter/ExtractionDeadLetterSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import type { ProxyEventVerdict } from "../../../storage/spac/SpacReportWriter";
import { SpacMergerExtractionRepo } from "../../../storage/spac/SpacMergerExtractionRepo";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { DocumentTreeSegmenter } from "../registration-statements/s1/DocumentTreeSegmenter";
import { S1_SECTIONS, type S1SectionName } from "../registration-statements/s1/DocumentSegmenter";
import { makeRunSection } from "../registration-statements/s1/sectionRunner";
import { boundSourceSpan, classifySpan } from "../registration-statements/s1/verifySourceSpan";
import { extractMergerDeal } from "../registration-statements/s1/sectionExtractors";
import type { MergerDealRow } from "../registration-statements/s1/mergerDealSchema";
import {
  getMergerProxyModels,
  getMergerProxyConfidenceFloor,
  modelExtractChain,
  persistModelId,
  resolveModelId,
} from "../registration-statements/s1/mergerModel";
import type { FormS1Parsed } from "../registration-statements/Form_S_1";
import {
  GENERAL_DEFINITIVE_PROXY_FORMS,
  MERGER_PROXY_OPTIONAL_FORMS,
  MERGER_PROXY_SECTION,
} from "../../../storage/versioning/extractorIds";
import { seeksCombinationApproval } from "./seeksCombinationApproval";

const EXTRACTOR_ID = "merger-proxy";
// Stays 1.0.0: no persisted data to re-extract, so the target_description
// addition needs no version bump (see the S-1 processor for the rationale).
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";
const MERGER_SECTION = MERGER_PROXY_SECTION;
/**
 * Definitive MERGER statements: the form symbol itself says the meeting is
 * about a combination, so these emit the `proxy` lifecycle event whether or not
 * the deal extraction succeeded.
 */
const DEFINITIVE_PROXY_FORMS = new Set(["DEFM14A", "DEFM14C"]);

/**
 * The dead-letter reasons that ARE a verdict about the document: the merger
 * section is absent, or a model read it and found no deal. Every other reason
 * — an unresolved model, a throttle, a nonce mismatch, the
 * `MODEL_INVALID_OUTPUT` catch-all — reports that this run never reached an
 * answer. Low-confidence and unverified-span rows are deliberately absent too:
 * the model did return a deal there, and only its citation or its certainty
 * failed.
 */
const NO_DEAL_REASONS = new Set<DeadLetterReasonCode>(["SECTION_NOT_FOUND", "MODEL_EMPTY"]);

/**
 * Which way this run moves the accession's `proxy` event.
 *
 * Both writes require evidence about the DOCUMENT. `seeks_combination_approval`
 * is deterministic and decides on its own when false: the gate is conjunctive,
 * so a statement that asks shareholders to approve nothing can never emit, with
 * or without a deal — which is what lets the recovery ceremony unwind a stale
 * close while a provider is down. A true verdict still needs the deal, and
 * there the distinction matters: a run whose extraction FAILED knows nothing
 * about the filing, so it leaves the stream alone rather than deleting an event
 * an earlier run recorded. Retracting there loses the whole approval stage —
 * the vehicle's next Form 25/15 inside the post-approval window stops reading
 * as a completed de-SPAC — and the failure re-occurs on every sweep.
 */
export function resolveProxyEventVerdict(args: {
  readonly form: string;
  readonly extractedDeal: boolean;
  /** This run concluded the filing discloses no deal (not merely: it failed). */
  readonly concludedNoDeal: boolean;
  readonly seeksCombinationApproval: boolean | null;
}): ProxyEventVerdict {
  if (DEFINITIVE_PROXY_FORMS.has(args.form)) return "emit";
  // Preliminary / revised statements never emit; retracting keeps a replay able
  // to clear an event some earlier generation of this code wrote for one.
  if (!GENERAL_DEFINITIVE_PROXY_FORMS.has(args.form)) return "retract";
  if (args.seeksCombinationApproval !== true) return "retract";
  if (args.extractedDeal) return "emit";
  return args.concludedNoDeal ? "retract" : "leave";
}

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
 * `DEFR14A`/`PRER14A`) plus the general definitive statements SPACs actually
 * file their combination votes on. Gated on a known SPAC. Persists a
 * `spac_merger_extraction` row, observes the target company, then records the
 * proxy event and recomputes deals (correlation derives target/pipe onto the
 * matching `spac_deal`).
 *
 * The proxy event is two-tier: a {@link DEFINITIVE_PROXY_FORMS} statement emits
 * it on the form symbol alone, so it still advances `proxy_date` when the
 * merger section is absent or low-confidence and the section dead-letters; a
 * {@link GENERAL_DEFINITIVE_PROXY_FORMS} one emits it only when this run
 * extracted a deal AND the document asks shareholders to approve it. Which way
 * the event moves — including the case where this run reached no verdict at all
 * — is {@link resolveProxyEventVerdict}.
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
  let models: ModelConfig[] = [];
  let modelError: string | null = null;
  try {
    models = args.model ? [args.model] : await getMergerProxyModels();
  } catch (err) {
    modelError = err instanceof Error ? err.message : String(err);
  }
  const model = models[0] ?? null;
  for (const m of models) await prefetchModel(resolveModelId(m), args.context);

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
  // null = not evaluated. Rendering the whole document is worth paying for only
  // on the general definitive forms, whose symbol does not say the meeting is
  // about a combination; the "M" forms decide on the symbol alone.
  let seeks_combination_approval: boolean | null = null;
  try {
    const doc = parseEdgarHtml(formMergerProxy.html, `${form} ${accession_number}`);
    const sections = new DocumentTreeSegmenter().segment(doc);
    byName = new Map<S1SectionName, string>(sections.map((s) => [s.name, s.text]));
    if (GENERAL_DEFINITIVE_PROXY_FORMS.has(form)) {
      seeks_combination_approval = seeksCombinationApproval(renderMarkdown(doc));
    }
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

  // A general proxy form with no merger section is an ordinary shareholder vote
  // — an annual meeting, a director election, an extension vote — not a failed
  // extraction. Those forms carry a SPAC's business-combination vote often
  // enough to be worth registering among the "merger-proxy" extractor's forms,
  // but most of them legitimately contain no deal, and dead-lettering each one
  // would bury the genuine failures under thousands of entries no operator can
  // act on. Record a successful run, emit no deal, and let the deterministic
  // proxy event below still advance the SPAC timeline.
  const mergerSectionOptional = MERGER_PROXY_OPTIONAL_FORMS.has(form);
  const skipMergerSection = mergerSectionOptional && mergerText === "";

  let idx = 0;
  // Evidence that this filing IS a merger proxy, for the general definitive
  // forms whose symbol does not say so.
  let extractedDeal = false;
  // Whether this run answered the question at all. A section that never reached
  // the model is not a filing that discloses no deal, and only the second of
  // those may move the proxy event.
  let concludedNoDeal = false;

  if (skipMergerSection) {
    // Nothing to extract, and nothing wrong — but the skip still needs a
    // durable trace. Every predicate that asks "did this proxy produce
    // anything" reads the extraction row, and a legitimately absent merger
    // section writes none; without a trace, an ordinary annual or extension
    // proxy of a known SPAC is indistinguishable from one whose handler was
    // gated on a missing spac row and dropped its work, so `spac process` and
    // `sec extractor backfill merger-proxy` re-select all 575 SPACs' general
    // proxies on every run, forever.
    //
    // Recorded RESOLVED: this is an answer, not a failure. It never reaches
    // `sec extractor dead-letters`, which lists pending entries, so the
    // worklist an operator reads is untouched — the same shape as the
    // auto-resolved `MODEL_EMPTY` rows the redemption / LOI detectors already
    // write per trigger 8-K.
    await deadLetters.recordResolved({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: MERGER_SECTION,
      reason_code: "SECTION_NOT_FOUND",
      detail: "no merger / business-combination / PIPE section text",
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    concludedNoDeal = true;
  } else if (!model) {
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
      signal: args.context?.signal,
    });
    try {
      const outcome = await runSection<MergerDealRow>({
        sectionName: MERGER_SECTION,
        text: mergerText === "" ? undefined : mergerText,
        notFoundDetail: "no merger / business-combination / PIPE section text",
        emptyDetail: "no merger deal returned",
        lowConfidenceDetail: "below confidence floor",
        verifyRow: (text, r) => classifySpan(text, r.source_span),
        unverifiedAllDetail: "merger deal source_span not present in section text",
        ...modelExtractChain(models, async (text, m) => {
          const deal = await extractMergerDeal(text, m, args.context);
          return deal === null ? [] : [deal];
        }),
        persist: async (rows, meta) => {
          const model_id = persistModelId(models, meta.modelIndex);
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
            equity_value: deal.equity_value ?? null,
            enterprise_value: deal.enterprise_value ?? null,
            merger_consideration: deal.merger_consideration,
            confidence: deal.confidence,
            source_span: boundSourceSpan(deal.source_span),
            seeks_combination_approval,
            model_id,
            created_at: now,
          });
          extractedDeal = true;
          return 1;
        },
      });
      concludedNoDeal = outcome.status === "dead-lettered" && NO_DEAL_REASONS.has(outcome.reason);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await recordMergerProxyRun(false, message);
      throw err;
    }
  }

  // Emit / retract the proxy event + recompute/correlate + rebuild.
  try {
    // The gate verdict is deterministic from the document, so a run that
    // extracted nothing still has one to record on a row an earlier run wrote.
    // Left NULL, the backfill's null-verdict clause re-selects this filing on
    // every sweep instead of extinguishing itself.
    if (seeks_combination_approval !== null && !extractedDeal) {
      await new SpacMergerExtractionRepo().recordApprovalVerdict(
        accession_number,
        seeks_combination_approval
      );
    }
    await new SpacReportWriter().recordMergerProxy({
      cik,
      accession_number,
      filing_date,
      form,
      primary_document: args.primary_doc ?? null,
      proxyEvent: resolveProxyEventVerdict({
        form,
        extractedDeal,
        concludedNoDeal,
        seeksCombinationApproval: seeks_combination_approval,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordMergerProxyRun(false, message);
    throw err;
  }

  await recordMergerProxyRun(true, null);
}
