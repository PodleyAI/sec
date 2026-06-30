/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ModelConfig } from "workglow";
import { globalServiceRegistry, renderMarkdown } from "workglow";
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
const DEFAULT_EXTRACTOR_VERSION = "1.0.0";
const REDEMPTION_SECTION = "redemption";

export interface ProcessRedemption8KArgs {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly itemCodes: readonly string[];
  readonly fullSubmissionText: string;
  readonly model?: ModelConfig;
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

  // Parsing/rendering filer-supplied HTML must not abort the filing (its 8-K
  // events and milestone deals already wrote); a malformed body dead-letters the
  // section so a version bump can retry it, mirroring the merger-proxy path.
  let text: string;
  try {
    const { primaryHtml, exhibitsHtml } = parseEightKSubmission(form, fullSubmissionText);
    text = [primaryHtml, ...exhibitsHtml]
      .map((h, i) => renderBody(h, `${form} ${accession_number} #${i}`))
      .filter((t) => t.length > 0)
      .join("\n\n");
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
        const row = await extractRedemption(t, model);
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
}
