/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  SPAC_LOCKUP_TERMS_REPOSITORY_TOKEN,
  type SpacLockupTerms,
  type SpacLockupTermsRepositoryStorage,
} from "./SpacLockupTermsSchema";

export class SpacLockupTermsRepo {
  private readonly storage: SpacLockupTermsRepositoryStorage;

  constructor(storage?: SpacLockupTermsRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(SPAC_LOCKUP_TERMS_REPOSITORY_TOKEN);
  }

  /**
   * Replaces a filing's lock-ups.
   *
   * Deletes before inserting because the rows are positional: a re-extraction
   * that finds three lock-ups where the last one found four would otherwise
   * leave the fourth behind, and a stale row here states a release date for a
   * holder class the filing does not lock up.
   */
  async replaceForFiling(
    extractor_id: string,
    accession_number: string,
    rows: readonly SpacLockupTerms[]
  ): Promise<void> {
    for (const existing of await this.listForFiling(extractor_id, accession_number)) {
      await this.storage.delete({
        extractor_id,
        accession_number,
        lockup_index: existing.lockup_index,
      });
    }
    if (rows.length > 0) await this.storage.putBulk([...rows]);
  }

  async listForFiling(extractor_id: string, accession_number: string): Promise<SpacLockupTerms[]> {
    const rows = (await this.storage.query({ extractor_id, accession_number })) ?? [];
    return [...rows].sort((a, b) => a.lockup_index - b.lockup_index);
  }

  async listAll(): Promise<SpacLockupTerms[]> {
    return (await this.storage.getAll()) ?? [];
  }

  /** Every lock-up an issuer has disclosed, newest extract first. */
  async listByCik(cik: number): Promise<SpacLockupTerms[]> {
    const rows = (await this.storage.query({ cik })) ?? [];
    return [...rows].sort(
      (a, b) =>
        b.created_at.localeCompare(a.created_at) ||
        b.accession_number.localeCompare(a.accession_number) ||
        a.lockup_index - b.lockup_index
    );
  }
}
