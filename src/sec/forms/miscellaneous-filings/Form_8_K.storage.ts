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
}: {
  readonly cik: number;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly form: string;
  readonly items: string | undefined | null;
  readonly report_date: string | undefined | null;
  readonly form8K: Form8K;
}): Promise<void> {
  const eventRepo = new Form8KEventRepo();
  const isAmendment = form === "8-K/A";

  const effectiveReportDate = form8K.formData?.periodOfReport || report_date || null;

  const itemCodes = extractItemCodes(items, form8K);

  for (const itemCode of itemCodes) {
    const event: Form8KEvent = {
      cik,
      accession_number,
      item_code: itemCode,
      item_description: Form_8_K_ITEMS[itemCode] ?? null,
      filing_date,
      report_date: effectiveReportDate,
      is_amendment: isAmendment,
    };
    await eventRepo.saveEvent(event);
  }
}
