/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IExecuteContext, ModelConfig } from "workglow";
import { globalServiceRegistry, renderMarkdown } from "workglow";
import { prefetchModel } from "../../../task/model/EnsureModelDownloadedTask";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { parseEightKSubmission } from "../registration-statements/s1/parseSubmission";
import { makeRunSection } from "../registration-statements/s1/sectionRunner";
import { boundSourceSpan, classifySpan } from "../registration-statements/s1/verifySourceSpan";
import { extractLoi } from "../registration-statements/s1/sectionExtractors";
import type { LoiRow } from "../registration-statements/s1/loiSchema";
import {
  getLoiModels,
  getLoiConfidenceFloor,
  modelExtractChain,
  persistModelId,
  resolveModelId,
} from "../registration-statements/s1/loiModel";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacLoiExtractionRepo } from "../../../storage/spac/SpacLoiExtractionRepo";
import { LOI_TRIGGER_ITEMS } from "./spac8kLoiTriggers";

const EXTRACTOR_ID = "loi";
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";
const LOI_SECTION = "loi";

/** Per-exhibit / total input caps; mirror the redemption extractor's. */
const MAX_PER_EXHIBIT_CHARS = 200_000;
const MAX_TOTAL_CHARS = 400_000;

export interface ProcessLoi8KArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly itemCodes: readonly string[];
  readonly fullSubmissionText: string;
  /** Event-date fallback when the narrative states no LOI date (report_date ?? filing_date). */
  readonly event_date?: string;
  readonly model?: ModelConfig;
  readonly context?: IExecuteContext;
}

/** Renders an EDGAR HTML body to plain markdown text (source-span verifiable). */
function renderBody(html: string, title: string): string {
  const doc = parseEdgarHtml(html, title);
  return doc.children
    .map((n) => renderMarkdown(n))
    .filter((s) => s.length > 0)
    .join("\n\n")
    .trim();
}

/** True when a model-supplied LOI date is a plausible YYYY-MM-DD string. */
function isIsoDate(value: string | null): value is string {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * AI-detect a NON-BINDING letter of intent in a known SPAC's 8-K narrative
 * (primary document + EX-99.x exhibits). There is no 8-K item code for an LOI
 * — it surfaces only as Item 1.01/7.01/8.01 narrative — so this is the sole
 * source of the `loi` lifecycle event. Gated on a trigger item and a known
 * SPAC. On a persisted extraction, `SpacReportWriter.recordLoi` appends the
 * `loi` event; `deriveDeals` opens/dates the attempt and the rollup lifts
 * `loi_date` / `status = "loi"` onto the spac row (a definitive agreement on
 * the same deal supersedes the LOI stage).
 */
export async function processLoi8K(args: ProcessLoi8KArgs): Promise<void> {
  const { cik, accession_number, filing_date, form, itemCodes, fullSubmissionText } = args;

  if (!itemCodes.some((c) => LOI_TRIGGER_ITEMS.includes(c))) return;

  const spacRepo = new SpacRepo();
  const spac = await spacRepo.getSpac(cik);
  if (!spac) return;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const extractorSlot = await getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  const slot_at_run = extractorSlot?.slot ?? "current";
  const deadLetters = new ExtractionDeadLetterRepo();
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));

  const recordLoiRun = async (success: boolean, error: string | null): Promise<void> => {
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

  // Model resolution must not abort the surrounding 8-K processing (its events
  // and milestone deals are already written). Mirrors the redemption path.
  let models: ModelConfig[];
  try {
    models = args.model ? [args.model] : await getLoiModels();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: LOI_SECTION,
      reason_code: "MODEL_RESOLUTION_ERROR",
      detail: message,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    await recordLoiRun(false, `MODEL_RESOLUTION_ERROR: ${message}`);
    return;
  }
  if (models.length === 0) {
    await recordLoiRun(false, "MODEL_RESOLUTION_ERROR: no model configured");
    return;
  }
  for (const m of models) await prefetchModel(resolveModelId(m), args.context);

  let text: string;
  let dropped = 0;
  let droppedChars = 0;
  let totalDropped = false;
  try {
    const { primaryHtml, exhibitsHtml } = parseEightKSubmission(form, fullSubmissionText);
    const survivors: string[] = [];
    [primaryHtml, ...exhibitsHtml].forEach((h, i) => {
      const rendered = renderBody(h, `${form} ${accession_number} #${i}`);
      if (rendered.length === 0) return;
      if (rendered.length > MAX_PER_EXHIBIT_CHARS) {
        dropped += 1;
        droppedChars += rendered.length;
        return;
      }
      survivors.push(rendered);
    });
    text = survivors.join("\n\n");
    if (text.length > MAX_TOTAL_CHARS) {
      totalDropped = true;
      dropped += survivors.length;
      droppedChars += text.length;
      text = "";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: LOI_SECTION,
      reason_code: "PARSE_ERROR",
      detail: message,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    await recordLoiRun(false, `PARSE_ERROR: ${message}`);
    return;
  }

  if (text === "" && dropped > 0) {
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: LOI_SECTION,
      reason_code: "OVERSIZED_INPUT",
      detail: totalDropped
        ? `surviving exhibits exceeded ${MAX_TOTAL_CHARS} char total cap (dropped=${dropped}, chars=${droppedChars})`
        : `every primary/EX-99 exhibit exceeded ${MAX_PER_EXHIBIT_CHARS} char per-exhibit cap (dropped=${dropped}, chars=${droppedChars})`,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    // Record a successful run so the deterministic-cap drop stays idempotent
    // for the backfill sweep (mirrors the redemption extractor).
    await recordLoiRun(true, null);
    return;
  }

  const runSection = makeRunSection({
    deadLetters,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    accession_number,
    confidenceFloor: getLoiConfidenceFloor(),
    signal: args.context?.signal,
  });

  let persistedRow: LoiRow | null = null;
  try {
    await runSection<LoiRow>({
      sectionName: LOI_SECTION,
      text: text === "" ? undefined : text,
      notFoundDetail: "no primary/EX-99 narrative text",
      // Most trigger-item 8-Ks carry no LOI at all; an empty extraction is the
      // expected negative outcome, not a failure worth a dead-letter — but
      // makeRunSection's MODEL_EMPTY entry keeps the audit trail consistent
      // with the other section extractors.
      emptyDetail: "no letter of intent reported",
      lowConfidenceDetail: "below confidence floor",
      verifyRow: (t, r) => classifySpan(t, r.source_span),
      unverifiedAllDetail: "LOI source_span not present in narrative text",
      ...modelExtractChain(
        models,
        async (t, m) => {
          const row = await extractLoi(t, m, args.context);
          return row === null ? [] : [row];
        },
        { fallbackOnEmpty: false }
      ),
      persist: async (rows, meta) => {
        const model_id = persistModelId(models, meta.modelIndex);
        const row = rows[0];
        await new SpacLoiExtractionRepo().save({
          accession_number,
          cik,
          form,
          filing_date,
          extractor_id: EXTRACTOR_ID,
          extractor_version,
          target_name: row.target_name,
          loi_date: isIsoDate(row.loi_date) ? row.loi_date : null,
          confidence: row.confidence,
          source_span: boundSourceSpan(row.source_span),
          model_id,
          created_at: new Date().toISOString(),
        });
        persistedRow = row;
        return 1;
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordLoiRun(false, message);
    throw err;
  }

  await recordLoiRun(true, null);

  // Unlike the other section extractors, "no LOI reported" is the EXPECTED
  // outcome for most trigger-item 8-Ks (1.01/7.01/8.01 carry all sorts of
  // announcements). Leaving the MODEL_EMPTY entry pending would flood the
  // version-gated retry worklist with confident negatives, so auto-resolve it
  // (the attempts counter keeps the audit trail). Genuine problems stay
  // pending: LOW_CONFIDENCE_ALL, UNVERIFIED_SOURCE_SPAN, NONCE_MISMATCH, and
  // MODEL_INVALID_OUTPUT — the section runner's catch-all for a throw it could
  // not classify (a provider 5xx, a schema rejection, a failure inside persist),
  // which is not a "no LOI" verdict about this filing.
  if (persistedRow === null) {
    const entry = await deadLetters.get(EXTRACTOR_ID, accession_number, LOI_SECTION);
    if (entry?.reason_code === "MODEL_EMPTY") {
      await deadLetters.markResolved(EXTRACTOR_ID, accession_number, LOI_SECTION);
    }
  }

  if (persistedRow !== null) {
    const row: LoiRow = persistedRow;
    const eventDate = isIsoDate(row.loi_date)
      ? row.loi_date
      : (args.event_date ?? filing_date);
    if (eventDate) {
      await new SpacReportWriter().recordLoi({
        cik,
        accession_number,
        filing_date,
        form,
        event_date: eventDate,
      });
    }
  }

  if (dropped > 0 && !totalDropped) {
    const partialSection = `${LOI_SECTION}-partial-oversized`;
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: partialSection,
      reason_code: "OVERSIZED_INPUT",
      detail: `dropped ${dropped} exhibit(s) over ${MAX_PER_EXHIBIT_CHARS} char cap (chars=${droppedChars})`,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    await deadLetters.markResolved(EXTRACTOR_ID, accession_number, partialSection);
  }
}
