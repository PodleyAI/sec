/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext } from "workglow";
import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import type { Form8KEvent } from "../../../storage/form-8k-event/Form8KEventSchema";
import { Form_8_K_ITEMS } from "./Form_8_K";
import type { Form8K } from "./Form_8_K.schema";

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
 * Records one `form_8k_events` row per item code the filing declares.
 *
 * The item codes and the report date are structured filing metadata: they
 * arrive in the submissions payload and in the XML envelope, and reading them
 * takes no exhibit, no narrative and no model. Whether those codes amount to a
 * de-SPAC milestone is a separate reading over the filing's prose and its
 * exhibit manifest, and belongs to whichever package owns the lifecycle model.
 * Both run over the same 8-K, under ids of their own.
 */
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
  /**
   * Threaded by the dispatcher and accepted so every extractor's `store` can
   * hand through one shape. Nothing here reports progress or prefetches, so it
   * is unread.
   */
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
}
