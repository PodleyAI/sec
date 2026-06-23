/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import type { Form8KEvent } from "../../../storage/form-8k-event/Form8KEventSchema";
import type { Form8K } from "./Form_8_K.schema";
import { Form_8_K_ITEMS } from "./Form_8_K";

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
}
