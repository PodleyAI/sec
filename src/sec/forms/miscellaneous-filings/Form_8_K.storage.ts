/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import { globalServiceRegistry } from "workglow";
import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import type { Form8KEvent } from "../../../storage/form-8k-event/Form8KEventSchema";
import { SPAC_CANDIDATE_REPOSITORY_TOKEN } from "../../../storage/spac/SpacCandidateSchema";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { pendingDealBefore } from "../../../storage/spac/spacDealGrouping";
import {
  parseEightKSubmission,
  parseSubmissionExhibits,
} from "../registration-statements/s1/parseSubmission";
import { Form_8_K_ITEMS } from "./Form_8_K";
import type { Form8K } from "./Form_8_K.schema";
import { processLoi8K } from "./loi8k";
import { processRedemption8K } from "./redemption8k";
import { htmlToPlainText, mapItemCodesToSpacEvents } from "./spac8kMilestones";

/**
 * Extracts item codes from the filing metadata `items` field.
 * The items field is a comma-separated string of item codes (e.g., "2.02,9.01").
 * Also merges any items found in the parsed XML form data.
 *
 * In practice `form8K.formData` is always empty for real 8-Ks: EDGAR 8-K bodies
 * are HTML/text, never `edgarSubmission` XML (see {@link Form_8_K.parse}), so the
 * metadata `items` field is the authoritative item list. The XML merge is kept as
 * a harmless belt-and-suspenders for the theoretical structured filing.
 */
function extractItemCodes(filingItems: string | undefined | null, form8K: Form8K): string[] {
  const itemSet = new Set<string>();

  if (filingItems) {
    for (const raw of filingItems.split(/[,;]/)) {
      const item = raw.trim();
      if (item) {
        itemSet.add(item);
      }
    }
  }

  if (form8K.formData?.items?.item) {
    const xmlItems = form8K.formData.items.item;
    const itemArray = Array.isArray(xmlItems) ? xmlItems : [xmlItems];
    for (const item of itemArray) {
      const trimmed = item.trim();
      if (trimmed) {
        itemSet.add(trimmed);
      }
    }
  }

  return [...itemSet].sort();
}

/**
 * 8-K item codes that can carry a de-SPAC lifecycle milestone. An 8-K whose
 * items include none of these writes no event whether or not the issuer has a
 * spac row, which is what lets `spac process` tell a filing gated by a missing
 * row from one that simply had nothing to say.
 */
export const MILESTONE_ITEM_CODES: ReadonlySet<string> = new Set([
  "1.01",
  "1.02",
  "2.01",
  "5.03",
  "5.07",
]);

/**
 * Whether the submissions-only SPAC screen has flagged this CIK. Read
 * defensively: the table is optional in a consumer's schema, and a missing
 * screen must silence the warning rather than fail the filing.
 */
async function isSpacCandidate(cik: number): Promise<boolean> {
  try {
    const repo = globalServiceRegistry.get(SPAC_CANDIDATE_REPOSITORY_TOKEN);
    return (await repo.get({ cik })) !== undefined;
  } catch {
    return false;
  }
}

export async function processForm8K({
  cik,
  accession_number,
  filing_date,
  form,
  items,
  report_date,
  form8K,
  extractor_id,
  extractor_version,
  fullSubmissionText,
  model,
  context,
}: {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly items: string | undefined | null;
  readonly report_date: string | undefined | null;
  readonly form8K: Form8K;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly fullSubmissionText?: string;
  readonly model?: ModelConfig;
  readonly context?: IExecuteContext;
}): Promise<void> {
  const eventRepo = new Form8KEventRepo();
  const isAmendment = form === "8-K/A";

  // `form8K.formData?.periodOfReport` is only ever populated for structured
  // `edgarSubmission` 8-Ks, which do not occur in real EDGAR data — so in
  // practice the metadata `report_date` is authoritative here. The XML fallback
  // stays first for the theoretical structured filing.
  const effectiveReportDate = form8K.formData?.periodOfReport || report_date || null;

  const itemCodes = extractItemCodes(items, form8K);

  // Build the full row set first so the atomic replace either lands all
  // items for this (filing, version) or none of them. A torn write would
  // otherwise leave the table with a partial item list that downstream
  // queries can't distinguish from a real partial-disclosure filing.
  const events: Array<Omit<Form8KEvent, "event_id">> = itemCodes.map((itemCode) => ({
    cik,
    accession_number,
    extractor_id,
    extractor_version,
    item_code: itemCode,
    item_description: Form_8_K_ITEMS[itemCode] ?? null,
    filing_date,
    report_date: effectiveReportDate,
    is_amendment: isAmendment,
  }));

  await eventRepo.replaceEvents(cik, accession_number, extractor_id, extractor_version, events);

  const spacRepo = new SpacRepo();
  const spacRow = await spacRepo.getSpac(cik);
  if (!spacRow) {
    // ORDER DEPENDENCE, made visible on purpose.
    //
    // The SPAC row is created by `recordRegistration` (S-1) or `recordIpo`
    // (424). Until one of those has run, an 8-K carrying real de-SPAC
    // milestones records NOTHING here — and the filing still reports success,
    // so a backfill that happens to process 8-Ks first silently produces an
    // empty timeline. That is not hypothetical: a SPAC with 58 8-Ks and no
    // 424B4 yielded zero events, every filing "successful", because its S-1 had
    // not been processed yet.
    //
    // Deliberately not auto-creating the row from here: an 8-K does not carry
    // the SIC, so this path cannot tell a SPAC from any other issuer, and
    // minting SPAC rows for every 8-K filer would be worse than the gap. Warn
    // instead, and process registration/IPO forms before 8-Ks in a backfill.
    //
    // The item codes alone are not evidence of a SPAC: 1.01/2.01/5.07 are
    // ordinary 8-K items every operating company files, so warning on them
    // fired on most 8-Ks in a corpus sweep and buried the real cases it exists
    // to surface. `spac_candidate` is the independent, document-free screen for
    // exactly this question, so require a row there before speaking. An issuer
    // the screen misses (94% recall overall, 86% on completed de-SPACs) loses
    // its warning — the right trade for one that is findable at volume.
    //
    // Warn from item-code presence, not the classified event type: without a
    // spac row there is no IPO date or pending deal, so the classifier would
    // call every 1.01 a material_agreement and the warning would never fire.
    const dropped = itemCodes.filter((c) => MILESTONE_ITEM_CODES.has(c));
    if (dropped.length > 0 && (await isSpacCandidate(cik))) {
      console.warn(
        `[8-K ${accession_number}] CIK ${cik} has no SPAC row, so ` +
          `${dropped.length} de-SPAC milestone event(s) were dropped. ` +
          `Process the S-1 / 424 for this issuer first, then re-run its 8-Ks.`
      );
    }
  } else {
    // Skip when no usable date is available: an undated milestone (empty
    // event_date) would write junk announced_date/definitive_agreement_date
    // onto the deal/row. Reachable only on the best-effort path where the
    // filing-metadata row is absent (report_date null, filing_date "").
    const eventDate = effectiveReportDate || filing_date;
    const exhibits = fullSubmissionText ? parseSubmissionExhibits(fullSubmissionText) : [];
    const narrative = fullSubmissionText
      ? htmlToPlainText(parseEightKSubmission(form, fullSubmissionText).primaryHtml)
      : null;
    // Classify from the events dated strictly BEFORE this filing, not from the
    // current derived deal set. Reading the deal set makes this filing's
    // classification depend on filings that came after it, so reprocessing it
    // demotes a `vote` to `eight_k` (the deal has since completed) or a
    // `terminated` to `material_agreement` (the deal is no longer pending) —
    // and the replace-then-append write in `recordDealMilestones` then erases
    // the lifecycle event the first pass recorded.
    const priorEvents = eventDate ? await spacRepo.getEvents(cik) : [];
    const pending = eventDate
      ? pendingDealBefore(cik, priorEvents, { event_date: eventDate, accession_number })
      : null;
    const spacEvents = eventDate
      ? mapItemCodesToSpacEvents(itemCodes, eventDate, {
          ipoDate: spacRow.ipo_date,
          registrationDate: spacRow.registration_date,
          exhibits,
          pendingDeal: pending,
          issuerName: spacRow.spac_name,
          narrative,
        })
      : [];
    if (spacEvents.length > 0) {
      await new SpacReportWriter().recordDealMilestones({
        cik,
        accession_number,
        filing_date,
        form,
        primary_document: null,
        events: spacEvents,
      });
      // De-SPAC linkage: item 2.01 completes the combination — link the shell to
      // its post-merger identity from the CIK's own post-close entity metadata.
      // Runs after the milestone write so the row's status is already `completed`.
      if (spacEvents.some((e) => e.event_type === "completed")) {
        await new SpacReportWriter().recordDeSpacLinkage({
          cik,
          accession_number,
          filing_date,
          form,
        });
      }
    }
  }

  if (spacRow && fullSubmissionText) {
    await processRedemption8K({
      cik,
      accession_number,
      filing_date,
      form,
      itemCodes,
      fullSubmissionText,
      model,
      context,
    });
    await processLoi8K({
      cik,
      accession_number,
      filing_date,
      form,
      itemCodes,
      fullSubmissionText,
      event_date: effectiveReportDate || filing_date,
      model,
      context,
    });
  }
}
