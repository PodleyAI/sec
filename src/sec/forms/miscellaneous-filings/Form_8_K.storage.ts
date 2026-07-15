/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "workglow";
import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import type { Form8KEvent } from "../../../storage/form-8k-event/Form8KEventSchema";
import type { Form8K } from "./Form_8_K.schema";
import { Form_8_K_ITEMS } from "./Form_8_K";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import { mapItemCodesToSpacEvents } from "./spac8kMilestones";
import { processRedemption8K } from "./redemption8k";
import { processLoi8K } from "./loi8k";

/**
 * Extracts item codes from the filing metadata `items` field.
 * The items field is a comma-separated string of item codes (e.g., "2.02,9.01").
 * Also merges any items found in the parsed XML form data.
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
}): Promise<void> {
  const eventRepo = new Form8KEventRepo();
  const isAmendment = form === "8-K/A";

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

  await eventRepo.replaceEvents(
    cik,
    accession_number,
    extractor_id,
    extractor_version,
    events
  );

  const spacRow = await new SpacRepo().getSpac(cik);
  if (spacRow) {
    // Skip when no usable date is available: an undated milestone (empty
    // event_date) would write junk announced_date/definitive_agreement_date
    // onto the deal/row. Reachable only on the best-effort path where the
    // filing-metadata row is absent (report_date null, filing_date "").
    const eventDate = effectiveReportDate || filing_date;
    const spacEvents = eventDate ? mapItemCodesToSpacEvents(itemCodes, eventDate) : [];
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
    });
  }
}
