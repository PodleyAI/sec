/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import {
  RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN,
  type RelatedPartyTransaction,
  type RelatedPartyTransactionRepositoryStorage,
} from "./RelatedPartyTransactionSchema";

export class RelatedPartyTransactionRepo {
  private readonly storage: RelatedPartyTransactionRepositoryStorage;

  constructor(storage?: RelatedPartyTransactionRepositoryStorage) {
    this.storage = storage ?? globalServiceRegistry.get(RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN);
  }

  async save(row: RelatedPartyTransaction): Promise<void> {
    await this.storage.put(row);
  }

  async queryByAccession(accession_number: string): Promise<RelatedPartyTransaction[]> {
    return (await this.storage.query({ accession_number })) ?? [];
  }

  /**
   * Removes every related-party transaction row for a filing. Rows are keyed by
   * `(accession_number, extractor_id, transaction_index)`, so re-extracting a
   * filing that now yields fewer rows would otherwise leave stale orphans at the
   * higher indices. Callers clear before re-inserting to stay idempotent.
   */
  async clear(accession_number: string): Promise<void> {
    const rows = (await this.storage.query({ accession_number })) ?? [];
    for (const row of rows) {
      await this.storage.delete({
        accession_number,
        extractor_id: row.extractor_id,
        transaction_index: row.transaction_index,
      });
    }
  }
}
