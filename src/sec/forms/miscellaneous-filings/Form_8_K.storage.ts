/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import { Form8KEvent } from "../../../storage/form-8k-event/Form8KEventSchema";
import { PersonRepo } from "../../../storage/person/PersonRepo";
import { CompanyRepo } from "../../../storage/company/CompanyRepo";
import { hasCompanyEnding } from "../../../storage/company/CompanyNormalization";
import { Form8K, Form8KSignature } from "./Form_8_K.schema";
import { Form_8_K_ITEMS } from "./Form_8_K";

const RELATION_TYPE_SIGNATURE = "form-8k:signature";

/**
 * Extracts item codes from the filing metadata `items` field.
 * The items field is a comma-separated string of item codes (e.g., "2.02,9.01").
 * Also merges any items found in the parsed XML form data.
 */
function extractItemCodes(filingItems: string | undefined | null, form8K: Form8K): string[] {
  const itemSet = new Set<string>();

  // Items from the filing index metadata (comma or semicolon separated)
  if (filingItems) {
    for (const raw of filingItems.split(/[,;]/)) {
      const item = raw.trim();
      if (item) {
        itemSet.add(item);
      }
    }
  }

  // Items from parsed XML form data (if available)
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

async function processSignature(
  cik: number,
  signature: Form8KSignature
): Promise<void> {
  const companyRepo = new CompanyRepo();
  const personRepo = new PersonRepo();

  const signerName = signature.signatureName;
  if (!signerName) return;

  const signatureTitle = signature.signatureTitle;
  const cleanTitles = [signatureTitle || "Signer"].filter(Boolean);

  if (hasCompanyEnding(signerName)) {
    const company = await companyRepo.saveCompany(signerName);
    await companyRepo.saveRelatedEntity(
      company.company_hash_id,
      RELATION_TYPE_SIGNATURE,
      cik,
      cleanTitles
    );
  } else {
    const savedPerson = await personRepo.savePerson({ name: signerName });
    await personRepo.saveRelatedEntity(
      savedPerson.person_hash_id,
      RELATION_TYPE_SIGNATURE,
      cik,
      cleanTitles
    );
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
}: {
  cik: number;
  accession_number: string;
  filing_date: string;
  form: string;
  items: string | undefined | null;
  report_date: string | undefined | null;
  form8K: Form8K;
}): Promise<void> {
  const eventRepo = new Form8KEventRepo();
  const isAmendment = form === "8-K/A";

  // Use period of report from XML if available, fallback to filing metadata
  const effectiveReportDate = form8K.formData?.periodOfReport ?? report_date ?? null;

  // Extract and store individual 8-K event items
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

  // Process signatures from XML form data (if available)
  if (form8K.formData?.signatureBlock?.signature) {
    const signatures = form8K.formData.signatureBlock.signature;
    const signatureArray = Array.isArray(signatures) ? signatures : [signatures];

    for (const signature of signatureArray) {
      try {
        await processSignature(cik, signature);
      } catch (error) {
        console.warn(`Failed to process 8-K signature:`, signature, error);
      }
    }
  }
}
