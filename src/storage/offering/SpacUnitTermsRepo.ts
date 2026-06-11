/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SPAC_UNIT_TERMS_REPOSITORY_TOKEN,
  type SpacUnitTerms,
  type SpacUnitTermsRepositoryStorage,
} from "./SpacUnitTermsSchema";

export class SpacUnitTermsRepo {
  private readonly storage: SpacUnitTermsRepositoryStorage;

  constructor(storage?: SpacUnitTermsRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(SPAC_UNIT_TERMS_REPOSITORY_TOKEN);
  }

  async save(row: SpacUnitTerms): Promise<void> {
    await this.storage.put(row);
  }

  async get(extractor_id: string, accession_number: string): Promise<SpacUnitTerms | undefined> {
    return this.storage.get({ extractor_id, accession_number });
  }

  /** All rows for an issuer (across extractor ids and filings), newest extract first. */
  async listByCik(cik: number): Promise<SpacUnitTerms[]> {
    const rows = (await this.storage.query({ cik })) ?? [];
    return rows.sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) ||
        b.accession_number.localeCompare(a.accession_number)
    );
  }
}
