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

  const { primaryHtml, exhibitsHtml } = parseEightKSubmission(form, fullSubmissionText);
  const text = [primaryHtml, ...exhibitsHtml]
    .map((h, i) => renderBody(h, `${form} ${accession_number} #${i}`))
    .filter((t) => t.length > 0)
    .join("\n\n");

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
}
