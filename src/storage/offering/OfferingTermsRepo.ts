/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  OFFERING_TERMS_REPOSITORY_TOKEN,
  type OfferingTerms,
  type OfferingTermsRepositoryStorage,
} from "./OfferingTermsSchema";

export class OfferingTermsRepo {
  private readonly storage: OfferingTermsRepositoryStorage;

  constructor(storage?: OfferingTermsRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(OFFERING_TERMS_REPOSITORY_TOKEN);
  }

  async save(row: OfferingTerms): Promise<void> {
    await this.storage.put(row);
  }

  async get(extractor_id: string, accession_number: string): Promise<OfferingTerms | undefined> {
    return this.storage.get({ extractor_id, accession_number });
  }

  /** All rows for an issuer (across extractor ids and filings), newest extract first. */
  async listByCik(cik: number): Promise<OfferingTerms[]> {
    const rows = (await this.storage.query({ cik })) ?? [];
    return rows.sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) ||
        b.accession_number.localeCompare(a.accession_number)
    );
  }
}
