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
import { spanAppearsIn } from "../registration-statements/s1/verifySourceSpan";
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
 * 8-K (primary document + EX-99.x exhibits). Gated on a trigger item and an
 * existing deal to attach to. Persists a redemption-extraction row and
 * recomputes deals so the redemption is correlated onto the matching deal.
 */
export async function processRedemption8K(args: ProcessRedemption8KArgs): Promise<void> {
  const { cik, accession_number, filing_date, form, itemCodes, fullSubmissionText } = args;

  if (!itemCodes.some((c) => REDEMPTION_TRIGGER_ITEMS.includes(c))) return;

  const spacRepo = new SpacRepo();
  const spac = await spacRepo.getSpac(cik);
  if (!spac) return;
  const deals = await spacRepo.getDeals(cik);
  if (deals.length === 0) return;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const extractorSlot = await getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  const deadLetters = new ExtractionDeadLetterRepo();
  const model = args.model ?? (await getRedemptionModel());
  const model_id = resolveModelId(model);

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
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: REDEMPTION_SECTION,
      reason_code: "PARSE_ERROR",
      detail: err instanceof Error ? err.message : String(err),
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
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
  await runSection<RedemptionRow>({
    sectionName: REDEMPTION_SECTION,
    text: text === "" ? undefined : text,
    notFoundDetail: "no primary/EX-99 narrative text",
    emptyDetail: "no redemption returned",
    lowConfidenceDetail: "below confidence floor",
    verifyRow: (t, r) => spanAppearsIn(t, r.source_span),
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
        source_span: row.source_span,
        model_id,
        created_at: new Date().toISOString(),
      });
      persisted = 1;
      return 1;
    },
  });

  if (persisted > 0) {
    await new SpacReportWriter().recordRedemption({ cik, accession_number, filing_date, form });
  }

  // Partial-drop: at least one exhibit was skipped but a non-empty survivor set
  // ran through extraction. Record an informational dead-letter so operators
  // can triage filings whose largest exhibit was dropped (mirrors the
  // "<section>-partial" pattern in sectionRunner.ts).
  if (dropped > 0 && !totalDropped) {
    await deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: `${REDEMPTION_SECTION}-partial-oversized`,
      reason_code: "OVERSIZED_INPUT",
      detail: `dropped ${dropped} exhibit(s) over ${MAX_PER_EXHIBIT_CHARS} char cap (chars=${droppedChars})`,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });
  }
}
