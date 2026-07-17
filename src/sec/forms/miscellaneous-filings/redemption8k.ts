/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { IExecuteContext, ModelConfig } from "workglow";
import { globalServiceRegistry, renderMarkdown } from "workglow";
import { prefetchModel } from "../../../config/ensureModelDownloaded";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import { parseEightKSubmission } from "../registration-statements/s1/parseSubmission";
import { makeRunSection } from "../registration-statements/s1/sectionRunner";
import { boundSourceSpan, verifyRowSpan } from "../registration-statements/s1/verifySourceSpan";
import { extractRedemption } from "../registration-statements/s1/sectionExtractors";
import type { RedemptionRow } from "../registration-statements/s1/redemptionSchema";
import {
  getRedemptionModel,
  getRedemptionConfidenceFloor,
  resolveModelId,
} from "../registration-statements/s1/redemptionModel";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../../storage/versioning/ExtractorRunSchema";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { SpacRedemptionExtractionRepo } from "../../../storage/spac/SpacRedemptionExtractionRepo";
import { REDEMPTION_TRIGGER_ITEMS } from "./spac8kRedemptionTriggers";

const EXTRACTOR_ID = "redemption";
// v1.1.0: per-exhibit + total input caps. Oversized exhibits are dropped (a
// truncated span would break source-span verification); a full-drop dead-letters
// without invoking the model. The dropped-exhibit accounting changes the prompt
// shape, so confidence calibration drifts — treat as a fresh dev cycle.
const DEFAULT_EXTRACTOR_VERSION = "1.1.0";
const REDEMPTION_SECTION = "redemption";

/**
 * Per-exhibit cap on rendered markdown handed to the model. ~200 KB covers any
 * realistic vote-results / closing 8-K narrative; anything larger is almost
 * certainly an EX-99 dump (or an injection vector) that won't fit in context
 * regardless.
 */
const MAX_PER_EXHIBIT_CHARS = 200_000;
/** Total cap across primary doc + surviving exhibits. */
const MAX_TOTAL_CHARS = 400_000;

export interface ProcessRedemption8KArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly itemCodes: readonly string[];
  readonly fullSubmissionText: string;
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

/**
 * AI-extract realized redemptions from a known SPAC's vote-results / closing
 * 8-K (primary document + EX-99.x exhibits). Gated on a trigger item and a
 * known SPAC. The extraction is persisted regardless of whether the SPAC
 * already has a `spac_deal` row: `deriveDeals` reads the full extraction set
 * on every recompute, so a deal minted by a later 1.01 8-K automatically
 * correlates an orphan redemption recorded here.
 */
export async function processRedemption8K(args: ProcessRedemption8KArgs): Promise<void> {
  const { cik, accession_number, filing_date, form, itemCodes, fullSubmissionText } = args;

  if (!itemCodes.some((c) => REDEMPTION_TRIGGER_ITEMS.includes(c))) return;

  const spacRepo = new SpacRepo();
  const spac = await spacRepo.getSpac(cik);
  if (!spac) return;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const extractorSlot = await getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  // bootstrapComponentVersions seeds the current slot for every known
  // extractor; the fallback only protects tests that bypass setupAllDatabases.
  const slot_at_run = extractorSlot?.slot ?? "current";
  const deadLetters = new ExtractionDeadLetterRepo();
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));

  const recordRedemptionRun = async (success: boolean, error: string | null): Promise<void> => {
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

  // Model resolution must not abort the surrounding 8-K processing — the
  // outer filing's events and milestone deals are already written, and a
  // misconfigured SEC_REDEMPTION_MODEL must not regress the unrelated 8-K
  // path. Treat resolution failure like PARSE_ERROR: dead-letter the section,
  // record the failed run, return cleanly.
  let model: ModelConfig;
  let model_id: string | null;
  try {
    model = args.model ?? (await getRedemptionModel());
    model_id = resolveModelId(model);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: REDEMPTION_SECTION,
      reason_code: "MODEL_RESOLUTION_ERROR",
      detail: message,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    await recordRedemptionRun(false, `MODEL_RESOLUTION_ERROR: ${message}`);
    return;
  }
  await prefetchModel(model, args.context);

  // Parsing/rendering filer-supplied HTML must not abort the filing (its 8-K
  // events and milestone deals already wrote); a malformed body dead-letters the
  // section so a version bump can retry it, mirroring the merger-proxy path.
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
      // Survivors still too large in aggregate. Drop everything — partial
      // truncation breaks source-span verification and a doubly-skewed prompt
      // is worse for calibration than a clean dead-letter.
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
      section_name: REDEMPTION_SECTION,
      reason_code: "PARSE_ERROR",
      detail: message,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    await recordRedemptionRun(false, `PARSE_ERROR: ${message}`);
    return;
  }

  // Full-drop (every part oversized, or surviving aggregate exceeded the total
  // cap): record an OVERSIZED_INPUT dead-letter and return without invoking
  // the model. Surfaces in `sec extractor dead-letters redemption` for triage.
  if (text === "" && dropped > 0) {
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: REDEMPTION_SECTION,
      reason_code: "OVERSIZED_INPUT",
      detail: totalDropped
        ? `surviving exhibits exceeded ${MAX_TOTAL_CHARS} char total cap (dropped=${dropped}, chars=${droppedChars})`
        : `every primary/EX-99 exhibit exceeded ${MAX_PER_EXHIBIT_CHARS} char per-exhibit cap (dropped=${dropped}, chars=${droppedChars})`,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
    // Record a successful run so the deterministic-cap drop is idempotent: the
    // backfill sweep (`listFilingsWithoutSuccessfulRun`) must not re-fetch and
    // re-drop this oversized submission on every invocation. The OVERSIZED_INPUT
    // dead-letter stays pending for triage and becomes retry-eligible only after
    // a version bump that raises the cap (mirrors the partial-oversized path).
    await recordRedemptionRun(true, null);
    return;
  }

  const runSection = makeRunSection({
    deadLetters,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    accession_number,
    confidenceFloor: getRedemptionConfidenceFloor(),
  });

  let persisted = 0;
  try {
    await runSection<RedemptionRow>({
      sectionName: REDEMPTION_SECTION,
      text: text === "" ? undefined : text,
      notFoundDetail: "no primary/EX-99 narrative text",
      emptyDetail: "no redemption returned",
      lowConfidenceDetail: "below confidence floor",
      verifyRow: (t, r) => verifyRowSpan(t, r.source_span),
      unverifiedAllDetail: "redemption source_span not present in narrative text",
      extract: async (t) => {
        const row = await extractRedemption(t, model, args.context);
        return row === null ? [] : [row];
      },
      persist: async (rows) => {
        const row = rows[0];
        await new SpacRedemptionExtractionRepo().save({
          accession_number,
          cik,
          form,
          filing_date,
          extractor_id: EXTRACTOR_ID,
          extractor_version,
          redemption_shares: row.redemption_shares,
          redemption_amount: row.redemption_amount,
          price_per_share: row.price_per_share,
          confidence: row.confidence,
          source_span: boundSourceSpan(row.source_span),
          model_id,
          created_at: new Date().toISOString(),
        });
        persisted = 1;
        return 1;
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordRedemptionRun(false, message);
    throw err;
  }

  await recordRedemptionRun(true, null);

  if (persisted > 0) {
    await new SpacReportWriter().recordRedemption({ cik, accession_number, filing_date, form });
  }

  // Partial-drop: at least one exhibit was skipped but a non-empty survivor set
  // ran through extraction. Record an informational dead-letter so operators
  // can triage filings whose largest exhibit was dropped (mirrors the
  // "<section>-partial" pattern in sectionRunner.ts), then immediately mark
  // it resolved: this is informational, auto-resolved (no retry recovers a
  // deterministic-cap drop); the attempts counter preserves the audit trail
  // across replays.
  if (dropped > 0 && !totalDropped) {
    const partialSection = `${REDEMPTION_SECTION}-partial-oversized`;
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
